-- Fix the club double-draft race (core-review P2, clubs.ts:819): two concurrent
-- buildNextClubMatchAction calls read the same busy-set and can draft the same idle
-- player into two pending matches; the real harm is both being STARTED, putting one
-- player in two live matches at once.
--
-- Guard at the in_progress transition (where the harm lands), atomically: a BEFORE
-- trigger takes a per-club advisory lock (serializes concurrent starts) and rejects
-- the start if any of the match's players is already in another in_progress match of
-- the same club. Array overlap (&&) ignores NULLs, so singles (player2 = NULL) don't
-- false-positive. Covers every path that sets in_progress (auto-queue, manual, court
-- move), not just one action.
CREATE OR REPLACE FUNCTION public.club_match_player_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF NEW.status = 'in_progress' THEN
    PERFORM pg_advisory_xact_lock(hashtext(NEW.club_id::text));
    IF EXISTS (
      SELECT 1 FROM public.club_matches m
      WHERE m.club_id = NEW.club_id
        AND m.status = 'in_progress'
        AND m.id <> NEW.id
        AND ARRAY[m.side_a_player1, m.side_a_player2, m.side_b_player1, m.side_b_player2]
            && ARRAY[NEW.side_a_player1, NEW.side_a_player2, NEW.side_b_player1, NEW.side_b_player2]
    ) THEN
      RAISE EXCEPTION 'club_player_busy' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.club_match_player_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_club_match_player_guard ON public.club_matches;
CREATE TRIGGER trg_club_match_player_guard
  BEFORE INSERT OR UPDATE ON public.club_matches
  FOR EACH ROW EXECUTE FUNCTION public.club_match_player_guard();
