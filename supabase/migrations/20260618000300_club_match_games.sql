-- Club match: per-set (game) detail.
-- Until now a club_match stored a single score pair (score_a/score_b). Casual club
-- play often spans multiple sets, so we add a `games` jsonb array ([{a,b}, …]) that
-- mirrors the tournament `matches.games` shape. The detailed per-set score lives in
-- `games`; the legacy score_a/score_b columns are kept for backward compat (older
-- rows still read them; the UI prefers `games` when present). The winner is chosen
-- MANUALLY by the organizer (winner_side) — it is NOT derived from the games.
ALTER TABLE public.club_matches
  ADD COLUMN IF NOT EXISTS games jsonb NOT NULL DEFAULT '[]'::jsonb;

-- New 5-arg signature holds the real logic. p_games has NO default on purpose: a
-- 4-named-arg call (from still-running master code) cannot satisfy the required
-- p_games, so PostgREST resolves each call to exactly ONE overload — no ambiguity,
-- no need to drop the legacy 4-arg during the deploy window. Body is otherwise
-- identical to 20260607001000 (games_played bump + same-side locked-pair decrement).
CREATE OR REPLACE FUNCTION public.finish_club_match(
  p_match_id uuid,
  p_winner_side text,
  p_score_a integer,
  p_score_b integer,
  p_games jsonb
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
        games         = COALESCE(p_games, '[]'::jsonb),
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

-- Legacy 4-arg overload kept as a thin wrapper so master code that calls the old
-- signature keeps working across the deploy window. Safe to drop in a follow-up
-- migration once the develop→master deploy has landed and no caller uses it.
-- CREATE OR REPLACE preserves the existing service_role-only grants.
CREATE OR REPLACE FUNCTION public.finish_club_match(
  p_match_id uuid,
  p_winner_side text DEFAULT NULL,
  p_score_a integer DEFAULT NULL,
  p_score_b integer DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM public.finish_club_match(p_match_id, p_winner_side, p_score_a, p_score_b, '[]'::jsonb);
END;
$$;

-- RPCs are service_role-only (project invariant). Restore grants for the new signature.
REVOKE EXECUTE ON FUNCTION public.finish_club_match(uuid, text, integer, integer, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finish_club_match(uuid, text, integer, integer, jsonb) TO service_role;
