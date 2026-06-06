-- Atomic match completion: set result + bump games_played / last_finished_at for all
-- (non-null) side players in one transaction. Avoids the read-then-write race on the
-- games_played counter. service_role only (mirrors record_match_score grants).
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
    RETURN; -- idempotent: don't double-count games
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
END;
$$;

REVOKE EXECUTE ON FUNCTION public.finish_club_match(uuid, text, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.finish_club_match(uuid, text, integer, integer) TO service_role;
