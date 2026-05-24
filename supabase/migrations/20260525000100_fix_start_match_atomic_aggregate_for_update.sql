-- Phase 12 review fix E1: split FOR UPDATE off the aggregate.
-- Postgres rejects locking clauses on aggregate queries (SQLSTATE 0A000:
-- "FOR UPDATE is not allowed with aggregate functions"). The previous body
-- did `SELECT count(*) ... FOR UPDATE` in one statement which threw at
-- runtime whenever the require_checkin gate fired with non-empty player IDs.
-- Fix: first `PERFORM 1 ... FOR UPDATE` to acquire the row locks, then a
-- separate `SELECT count(*)` without FOR UPDATE.

CREATE OR REPLACE FUNCTION public.start_match_atomic(
  p_match_id uuid,
  p_player_ids uuid[]
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_match_status text;
  v_unchecked_count int;
BEGIN
  SELECT status INTO v_match_status
  FROM public.matches
  WHERE id = p_match_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;

  IF v_match_status = 'completed' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'completed');
  END IF;
  IF v_match_status = 'in_progress' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'in_progress');
  END IF;

  IF p_player_ids IS NOT NULL AND array_length(p_player_ids, 1) > 0 THEN
    -- Lock the candidate rows first (Postgres rejects FOR UPDATE on aggregate
    -- queries — SQLSTATE 0A000). Then count without the lock clause.
    PERFORM 1
    FROM public.team_players
    WHERE id = ANY(p_player_ids)
    FOR UPDATE;

    SELECT count(*) INTO v_unchecked_count
    FROM public.team_players
    WHERE id = ANY(p_player_ids) AND checked_in_at IS NULL;

    IF v_unchecked_count > 0 THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'unchecked', 'count', v_unchecked_count);
    END IF;
  END IF;

  UPDATE public.matches
  SET status = 'in_progress', started_at = NOW()
  WHERE id = p_match_id AND status = 'pending';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'status_changed');
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

COMMENT ON FUNCTION public.start_match_atomic(uuid, uuid[]) IS
  'Phase 12: atomic start-match gate. Locks the match row + locks the supplied team_players rows + counts unchecked, then transitions status pending -> in_progress in the same transaction. Two-step (PERFORM ... FOR UPDATE, then aggregate without FOR UPDATE) because Postgres rejects locking with aggregates (SQLSTATE 0A000). Court occupancy still enforced by partial unique index uniq_matches_inprogress_court.';
