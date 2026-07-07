-- Batch queue "ผู้ชนะจากแมตช์ #N": when a feeder match completes with a winner,
-- copy the winning side's player ids into the target match's placeholder side
-- (winner_next_match_id / winner_next_match_slot — see 20260707000200).
--
-- Zero-downtime: CREATE OR REPLACE of the existing 5-arg signature (unchanged),
-- so the 4-arg legacy wrapper keeps delegating and grants are preserved. Rows
-- without a pointer (everything pre-batch-queue) skip the new block entirely.
--
-- Promotion rules:
--   * only when p_winner_side is 'a'/'b' (a no-result finish promotes nobody)
--   * target must still be pending AND the target side fully empty — an
--     organizer's manual inline edit always beats the automatic promotion
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
  v_w1 uuid;
  v_w2 uuid;
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

  -- Winner promotion into the chained match's placeholder side.
  IF m.winner_next_match_id IS NOT NULL
     AND m.winner_next_match_slot IN ('a','b')
     AND p_winner_side IN ('a','b') THEN
    IF p_winner_side = 'a' THEN
      v_w1 := m.side_a_player1;
      v_w2 := m.side_a_player2;
    ELSE
      v_w1 := m.side_b_player1;
      v_w2 := m.side_b_player2;
    END IF;

    IF m.winner_next_match_slot = 'a' THEN
      UPDATE public.club_matches t
         SET side_a_player1 = v_w1,
             side_a_player2 = v_w2
       WHERE t.id = m.winner_next_match_id
         AND t.status = 'pending'
         AND t.side_a_player1 IS NULL
         AND t.side_a_player2 IS NULL;
    ELSE
      UPDATE public.club_matches t
         SET side_b_player1 = v_w1,
             side_b_player2 = v_w2
       WHERE t.id = m.winner_next_match_id
         AND t.status = 'pending'
         AND t.side_b_player1 IS NULL
         AND t.side_b_player2 IS NULL;
    END IF;
  END IF;
END;
$$;
