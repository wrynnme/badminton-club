-- Locked pairs: two players who must be teammates (same side) when the queue builds
-- a doubles match. games_remaining NULL = locked forever; N = locked for N more games
-- played together, then auto-released. Only meaningful when players_per_team=2.
CREATE TABLE IF NOT EXISTS public.club_locked_pairs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id uuid NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  player1_id uuid NOT NULL REFERENCES public.club_players(id) ON DELETE CASCADE,
  player2_id uuid NOT NULL REFERENCES public.club_players(id) ON DELETE CASCADE,
  games_remaining integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT club_locked_pairs_distinct CHECK (player1_id <> player2_id),
  CONSTRAINT club_locked_pairs_games_nonneg CHECK (games_remaining IS NULL OR games_remaining >= 0)
);

CREATE INDEX IF NOT EXISTS idx_club_locked_pairs_club ON public.club_locked_pairs(club_id);
CREATE INDEX IF NOT EXISTS idx_club_locked_pairs_p1 ON public.club_locked_pairs(player1_id);
CREATE INDEX IF NOT EXISTS idx_club_locked_pairs_p2 ON public.club_locked_pairs(player2_id);

ALTER TABLE public.club_locked_pairs ENABLE ROW LEVEL SECURITY;
CREATE POLICY club_locked_pairs_read_all ON public.club_locked_pairs FOR SELECT USING (true);

-- Extend finish RPC: after counting the game, decrement any N-game lock whose BOTH
-- members played in this match, and auto-release locks that hit 0.
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

  -- Decrement N-game locks whose both members played in this match; release at 0.
  UPDATE public.club_locked_pairs
    SET games_remaining = games_remaining - 1
  WHERE club_id = m.club_id
    AND games_remaining IS NOT NULL
    AND player1_id IN (m.side_a_player1, m.side_a_player2, m.side_b_player1, m.side_b_player2)
    AND player2_id IN (m.side_a_player1, m.side_a_player2, m.side_b_player1, m.side_b_player2);

  DELETE FROM public.club_locked_pairs
  WHERE club_id = m.club_id
    AND games_remaining IS NOT NULL
    AND games_remaining <= 0;
END;
$$;