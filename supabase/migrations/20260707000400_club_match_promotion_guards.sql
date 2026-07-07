-- Defense-in-depth + reversibility for the batch-queue winner-promotion chain
-- (see 20260707000300). Three guards, none of which change the happy path:
--
--  1. finish_club_match — never promote an EMPTY winner side. Finishing a chained
--     match whose winning side is still an un-promoted "ผู้ชนะจากแมตช์ #N" placeholder
--     (out of order — only reachable by a direct RPC/action call; the UI finishes
--     in_progress matches only) would copy (NULL, NULL) into the next slot and
--     strand it. Skip promotion when the winning side has no players.
--  2. finish_club_match — a no-result finish (p_winner_side NULL) on a FEEDER row
--     (winner_next_match_id set) is now rejected at the DB too, not only in the
--     server action: it would leave the chained slot empty forever.
--  3. delete_club_match — reverse a prior promotion. Deleting a completed feeder
--     now clears the winner it promoted out of the still-pending target slot (only
--     when the slot still holds exactly that winner — never clobber a manual edit),
--     so a wrong-winner → delete → redo flow can't strand a ghost roster that the
--     promotion guard (target side IS NULL) would then be unable to overwrite.
--
-- CREATE OR REPLACE preserves existing grants; both functions keep service_role-only
-- access. Zero-downtime: existing callers see identical behaviour on valid input.

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

  -- (2) a feeder must record a winner (mirror of the finishClubMatchAction guard)
  IF p_winner_side IS NULL AND m.winner_next_match_id IS NOT NULL THEN
    RAISE EXCEPTION 'club_feeder_needs_winner' USING ERRCODE = 'P0001';
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

    -- (1) never promote an empty (un-resolved placeholder) side into the chain
    IF v_w1 IS NOT NULL THEN
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
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_club_match(p_match_id uuid) RETURNS void
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
    UPDATE public.club_players
      SET games_played = GREATEST(games_played - 1, 0)
    WHERE id IN (m.side_a_player1, m.side_a_player2, m.side_b_player1, m.side_b_player2);

    -- (3) reverse this match's winner promotion: if it fed a still-pending chained
    -- match, clear the promoted winner out of that slot so a redo isn't blocked by
    -- the promotion guard (slot IS NULL) and no ghost roster is stranded. Only clear
    -- when the target still holds EXACTLY this match's winner (IS NOT DISTINCT FROM
    -- is null-safe for singles) — never clobber a manual re-edit.
    IF m.winner_next_match_id IS NOT NULL AND m.winner_side IN ('a','b') THEN
      IF m.winner_side = 'a' THEN
        v_w1 := m.side_a_player1;
        v_w2 := m.side_a_player2;
      ELSE
        v_w1 := m.side_b_player1;
        v_w2 := m.side_b_player2;
      END IF;
      IF m.winner_next_match_slot = 'a' THEN
        UPDATE public.club_matches t
           SET side_a_player1 = NULL, side_a_player2 = NULL
         WHERE t.id = m.winner_next_match_id
           AND t.status = 'pending'
           AND t.side_a_player1 IS NOT DISTINCT FROM v_w1
           AND t.side_a_player2 IS NOT DISTINCT FROM v_w2;
      ELSIF m.winner_next_match_slot = 'b' THEN
        UPDATE public.club_matches t
           SET side_b_player1 = NULL, side_b_player2 = NULL
         WHERE t.id = m.winner_next_match_id
           AND t.status = 'pending'
           AND t.side_b_player1 IS NOT DISTINCT FROM v_w1
           AND t.side_b_player2 IS NOT DISTINCT FROM v_w2;
      END IF;
    END IF;
  END IF;

  DELETE FROM public.club_matches WHERE id = p_match_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.delete_club_match(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_club_match(uuid) TO service_role;
