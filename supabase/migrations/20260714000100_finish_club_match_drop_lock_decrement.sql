-- Locked-pair "N games" quota moves to DERIVE semantics (v0.37.0):
--   club_locked_pairs.games_remaining is now the IMMUTABLE quota (NULL = forever).
--   The live remaining is computed by the app as quota − teammate-matches already on
--   the board (pending + in_progress + completed), so cancel/delete refunds a game
--   automatically and the generator stops forcing a pair once its quota is queued up.
--
-- This migration removes the old finish-time mutation from finish_club_match: it used
-- to `games_remaining -= 1` and DELETE the lock at 0. Under the new semantics that
-- would wrongly shrink the quota and auto-remove locks (the owner now unlocks manually).
-- Everything else in the function is byte-identical to 20260707000400 (winner-promotion
-- + its two guards). CREATE OR REPLACE preserves the existing service_role-only grant.

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
    RETURN; -- idempotent: don't double-count games
  END IF;

  -- a feeder must record a winner (mirror of the finishClubMatchAction guard)
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

  -- (Locked-pair quota is no longer mutated here — remaining is derived in the app.)

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

    -- never promote an empty (un-resolved placeholder) side into the chain
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
