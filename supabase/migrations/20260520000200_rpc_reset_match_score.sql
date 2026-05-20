-- P1-B fix: atomic reset_match_score RPC
-- Wraps the 3-step bracket cascade (next_match clear, loser_next_match clear,
-- subject row reset) in a single transaction with FOR UPDATE row locks.
-- Replaces the 3 separate UPDATE calls in resetMatchScoreAction that had
-- no transaction wrapper and could leave orphan bracket state on crash.
--
-- Responsibility split:
--   RPC  — locks rows, validates status, cascades slot/score resets, assigns tail pos
--   TS   — group-standings reversal, allow_force_bracket_reset guard, audit log
--
-- p_col_prefix: 'team' or 'pair' (determines which _a_id/_b_id slot to null).
-- p_allow_force_reset: when false, RAISE if next/loser-next is completed.

CREATE OR REPLACE FUNCTION public.reset_match_score(
  p_match_id          uuid,
  p_tournament_id     uuid,
  p_col_prefix        text,     -- 'team' | 'pair'
  p_allow_force_reset boolean
)
RETURNS int   -- new queue_position
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_match             record;
  v_next              record;
  v_loser_next        record;
  v_tail              int;
  v_next_slot_col     text;
  v_loser_slot_col    text;
BEGIN
  IF p_col_prefix NOT IN ('team', 'pair') THEN
    RAISE EXCEPTION 'invalid_col_prefix' USING ERRCODE = '22023';
  END IF;

  -- Lock subject row first.
  SELECT id, status, round_type,
         next_match_id, next_match_slot,
         loser_next_match_id, loser_next_match_slot
    INTO v_match
    FROM public.matches
   WHERE id            = p_match_id
     AND tournament_id = p_tournament_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'match_not_found' USING ERRCODE = '22023';
  END IF;

  IF v_match.status <> 'completed' THEN
    RAISE EXCEPTION 'match_not_completed' USING ERRCODE = '22023';
  END IF;

  -- ── next_match cascade ────────────────────────────────────────────────────
  IF v_match.next_match_id IS NOT NULL AND v_match.next_match_slot IS NOT NULL THEN
    SELECT id, status
      INTO v_next
      FROM public.matches
     WHERE id = v_match.next_match_id
       FOR UPDATE;

    IF FOUND AND v_next.status = 'completed' AND NOT p_allow_force_reset THEN
      RAISE EXCEPTION 'next_match_already_completed' USING ERRCODE = '22023';
    END IF;

    v_next_slot_col := p_col_prefix || '_' || v_match.next_match_slot || '_id';

    IF FOUND THEN
      IF v_next.status = 'completed' THEN
        -- force-reset: wipe score + clear slot
        EXECUTE format(
          'UPDATE public.matches SET %I = NULL,
             games = ''[]''::jsonb, team_a_score = NULL, team_b_score = NULL,
             winner_id = NULL, status = ''pending''
           WHERE id = $1',
          v_next_slot_col
        ) USING v_next.id;
      ELSE
        EXECUTE format(
          'UPDATE public.matches SET %I = NULL WHERE id = $1',
          v_next_slot_col
        ) USING v_next.id;
      END IF;
    END IF;
  END IF;

  -- ── loser_next_match cascade ──────────────────────────────────────────────
  IF v_match.loser_next_match_id IS NOT NULL AND v_match.loser_next_match_slot IS NOT NULL THEN
    SELECT id, status
      INTO v_loser_next
      FROM public.matches
     WHERE id = v_match.loser_next_match_id
       FOR UPDATE;

    IF FOUND AND v_loser_next.status = 'completed' AND NOT p_allow_force_reset THEN
      RAISE EXCEPTION 'loser_next_match_already_completed' USING ERRCODE = '22023';
    END IF;

    v_loser_slot_col := p_col_prefix || '_' || v_match.loser_next_match_slot || '_id';

    IF FOUND THEN
      IF v_loser_next.status = 'completed' THEN
        EXECUTE format(
          'UPDATE public.matches SET %I = NULL,
             games = ''[]''::jsonb, team_a_score = NULL, team_b_score = NULL,
             winner_id = NULL, status = ''pending''
           WHERE id = $1',
          v_loser_slot_col
        ) USING v_loser_next.id;
      ELSE
        EXECUTE format(
          'UPDATE public.matches SET %I = NULL WHERE id = $1',
          v_loser_slot_col
        ) USING v_loser_next.id;
      END IF;
    END IF;
  END IF;

  -- ── tail position (advisory lock for per-tournament serialisation) ─────────
  PERFORM pg_advisory_xact_lock(hashtext(p_tournament_id::text));

  SELECT COALESCE(MAX(queue_position), 0) + 1
    INTO v_tail
    FROM public.matches
   WHERE tournament_id = p_tournament_id
     AND status        = 'pending';

  -- ── reset subject row ─────────────────────────────────────────────────────
  UPDATE public.matches
     SET games          = '[]'::jsonb,
         team_a_score   = NULL,
         team_b_score   = NULL,
         winner_id      = NULL,
         status         = 'pending',
         queue_position = v_tail
   WHERE id = p_match_id;

  RETURN v_tail;
END;
$$;

REVOKE ALL ON FUNCTION public.reset_match_score(uuid, uuid, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reset_match_score(uuid, uuid, text, boolean) TO service_role;
