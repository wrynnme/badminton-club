-- Fix: the N-game lock decrement in finish_club_match matched a pair whose two
-- members were ANYWHERE in the 4 player slots — including on OPPOSITE sides. The
-- rotation queue always co-seats a lock on one side, but createClubManualMatchAction
-- can split a locked pair as opponents; finishing such a match wrongly burned a
-- lock-game (and could auto-release the lock) though the pair never played together.
-- Decrement only when both members are on the SAME side (true teammates).
CREATE OR REPLACE FUNCTION public.finish_club_match(
  p_match_id uuid,
  p_winner_side text DEFAULT NULL,
  p_score_a integer DEFAULT NULL,
  p_score_b integer DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  m public.club_matches;
BEGIN
  SELECT * INTO m FROM public.club_matches WHERE id = p_match_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'club_match % not found', p_match_id;
  END IF;
  IF m.status = 'completed' THEN
    RETURN; -- idempotent: don't double-count games / locks
  END IF;

  UPDATE public.club_matches
    SET status        = 'completed',
        winner_side   = p_winner_side,
        score_a       = p_score_a,
        score_b       = p_score_b,
        ended_at      = now(),
        queue_position = NULL
  WHERE id = p_match_id;

  -- IN-list ignores NULL entries, so singles (player2 NULL) are handled naturally.
  UPDATE public.club_players
    SET games_played     = games_played + 1,
        last_finished_at = now()
  WHERE id IN (m.side_a_player1, m.side_a_player2, m.side_b_player1, m.side_b_player2);

  -- Decrement N-game locks ONLY when both members were teammates (same side) in
  -- this match; release at 0. Opponents-split (e.g. via a manual match) no longer
  -- burns the lock.
  UPDATE public.club_locked_pairs
    SET games_remaining = games_remaining - 1
  WHERE club_id = m.club_id
    AND games_remaining IS NOT NULL
    AND (
      (player1_id IN (m.side_a_player1, m.side_a_player2)
        AND player2_id IN (m.side_a_player1, m.side_a_player2))
      OR
      (player1_id IN (m.side_b_player1, m.side_b_player2)
        AND player2_id IN (m.side_b_player1, m.side_b_player2))
    );

  DELETE FROM public.club_locked_pairs
  WHERE club_id = m.club_id
    AND games_remaining IS NOT NULL
    AND games_remaining <= 0;
END;
$$;
