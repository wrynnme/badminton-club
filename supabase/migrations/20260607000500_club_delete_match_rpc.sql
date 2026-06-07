-- Delete a club match (wrong entry). For a completed match, revert the game count
-- (games_played - 1, floor 0) for its players. in_progress never incremented games,
-- so no revert there. last_finished_at and N-game lock decrements are NOT restored
-- (overwritten/irreversible) — the UI confirm dialog states this. service_role only.
CREATE OR REPLACE FUNCTION public.delete_club_match(p_match_id uuid) RETURNS void
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
    UPDATE public.club_players
      SET games_played = GREATEST(games_played - 1, 0)
    WHERE id IN (m.side_a_player1, m.side_a_player2, m.side_b_player1, m.side_b_player2);
  END IF;

  DELETE FROM public.club_matches WHERE id = p_match_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.delete_club_match(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_club_match(uuid) TO service_role;
