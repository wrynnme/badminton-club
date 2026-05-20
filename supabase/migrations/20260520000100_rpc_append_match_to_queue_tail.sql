-- P1-A fix: atomic queue-tail RPCs
-- Uses pg_advisory_xact_lock for per-tournament serialisation so that
-- concurrent callers (cancelMatch + createManual + resetMatch) cannot
-- both read max(queue_position)=N and both write queue_position=N+1.
--
-- Three RPCs:
--   cancel_match_to_queue_tail  — in_progress  → pending  (clears started_at)
--   reset_match_to_queue_tail   — completed    → pending  (clears score/winner)
--   create_manual_match         — INSERT + tail position in one transaction

-- ─── cancel_match_to_queue_tail ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cancel_match_to_queue_tail(
  p_match_id      uuid,
  p_tournament_id uuid
)
RETURNS int
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_tail int;
  v_rows int;
BEGIN
  -- Per-tournament advisory lock held for the duration of this transaction.
  PERFORM pg_advisory_xact_lock(hashtext(p_tournament_id::text));

  SELECT COALESCE(MAX(queue_position), 0) + 1
    INTO v_tail
    FROM public.matches
   WHERE tournament_id = p_tournament_id
     AND status = 'pending';

  UPDATE public.matches
     SET status         = 'pending',
         started_at     = NULL,
         queue_position = v_tail
   WHERE id            = p_match_id
     AND tournament_id = p_tournament_id
     AND status        = 'in_progress';

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RAISE EXCEPTION 'match_not_found_or_not_in_progress'
      USING ERRCODE = '22023';
  END IF;

  RETURN v_tail;
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_match_to_queue_tail(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_match_to_queue_tail(uuid, uuid) TO service_role;


-- ─── reset_match_to_queue_tail ────────────────────────────────────────────────
-- Clears score/winner/status atomically. The cascade cleanup of next_match
-- slots and group-standings reversal stays in the TypeScript action so that
-- allow_force_bracket_reset guard and reverseGroupTeamStandings remain
-- co-located with the permission checks.
CREATE OR REPLACE FUNCTION public.reset_match_to_queue_tail(
  p_match_id      uuid,
  p_tournament_id uuid
)
RETURNS int
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_tail int;
  v_rows int;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(p_tournament_id::text));

  SELECT COALESCE(MAX(queue_position), 0) + 1
    INTO v_tail
    FROM public.matches
   WHERE tournament_id = p_tournament_id
     AND status        = 'pending';

  UPDATE public.matches
     SET games          = '[]'::jsonb,
         team_a_score   = NULL,
         team_b_score   = NULL,
         winner_id      = NULL,
         status         = 'pending',
         queue_position = v_tail
   WHERE id            = p_match_id
     AND tournament_id = p_tournament_id
     AND status        = 'completed';

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RAISE EXCEPTION 'match_not_found_or_not_completed'
      USING ERRCODE = '22023';
  END IF;

  RETURN v_tail;
END;
$$;

REVOKE ALL ON FUNCTION public.reset_match_to_queue_tail(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reset_match_to_queue_tail(uuid, uuid) TO service_role;


-- ─── create_manual_match ─────────────────────────────────────────────────────
-- INSERT + tail-position assignment in one transaction.
-- Returns the new match UUID so the caller can use it for audit logging.
CREATE OR REPLACE FUNCTION public.create_manual_match(
  p_tournament_id uuid,
  p_team_a_id     uuid,
  p_team_b_id     uuid,
  p_pair_a_id     uuid,
  p_pair_b_id     uuid,
  p_match_number  int,
  p_division      text    -- 'upper' | 'lower' | NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_tail     int;
  v_match_id uuid := gen_random_uuid();
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(p_tournament_id::text));

  SELECT COALESCE(MAX(queue_position), 0) + 1
    INTO v_tail
    FROM public.matches
   WHERE tournament_id = p_tournament_id
     AND status        = 'pending';

  INSERT INTO public.matches (
    id,              tournament_id,
    round_type,      round_number,   match_number,
    team_a_id,       team_b_id,
    pair_a_id,       pair_b_id,
    division,        games,          status,   queue_position
  ) VALUES (
    v_match_id,      p_tournament_id,
    'group',         1,              p_match_number,
    p_team_a_id,     p_team_b_id,
    p_pair_a_id,     p_pair_b_id,
    p_division,      '[]'::jsonb,   'pending', v_tail
  );

  RETURN v_match_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_manual_match(uuid, uuid, uuid, uuid, uuid, int, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_manual_match(uuid, uuid, uuid, uuid, uuid, int, text) TO service_role;
