-- Phase 12 Wave A: atomic require_checkin gate.
-- Locks the match row + re-checks team_players.checked_in_at for the supplied
-- player IDs within the same transaction, then transitions pending -> in_progress.
-- Closes the TOCTOU window between the JS-level check and the UPDATE in startMatchAction.

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
    SELECT count(*) INTO v_unchecked_count
    FROM public.team_players
    WHERE id = ANY(p_player_ids) AND checked_in_at IS NULL
    FOR UPDATE;

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

REVOKE ALL ON FUNCTION public.start_match_atomic(uuid, uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.start_match_atomic(uuid, uuid[]) TO service_role;

COMMENT ON FUNCTION public.start_match_atomic(uuid, uuid[]) IS
  'Phase 12: atomic start-match gate. Locks the match row + checks team_players.checked_in_at for the supplied player IDs within the same transaction, then transitions status pending -> in_progress. Returns jsonb with ok + reason (not_found/completed/in_progress/unchecked/status_changed). Court occupancy still enforced by partial unique index uniq_matches_inprogress_court.';
