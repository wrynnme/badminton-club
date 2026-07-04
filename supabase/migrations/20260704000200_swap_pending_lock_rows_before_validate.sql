-- P2 fix candidate — NOT YET APPLIED (deferred per P2+prod-migration policy;
-- apply in a maintenance window after approval).
--
-- Found by T5 race-hardening probe R2 (2026-07-04, incidence 26/30 rounds):
-- swap_pending_match_numbers validates "all ids pending" BEFORE its two
-- renumber passes, and start_match_atomic does not take the tournament
-- advisory lock — a start that commits between the validation and the UPDATE
-- reaching that row renumbers an in_progress match (its "#N" changes on every
-- screen mid-game).
--
-- Fix: row-lock the target matches (FOR UPDATE) immediately after the advisory
-- lock and BEFORE validation. A concurrent start_match_atomic (which takes
-- FOR UPDATE on the same row) then either commits first — validation cleanly
-- rejects with "not pending" — or blocks until the swap commits and starts the
-- match with its new number. Closes the window entirely; expected R2 result
-- after apply: renumberedInProgress = 0.

CREATE OR REPLACE FUNCTION public.swap_pending_match_numbers(
  p_tournament_id uuid,
  p_ordered_ids uuid[]
)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_sorted_nums integer[];
  v_i           integer;
BEGIN
  IF p_ordered_ids IS NULL OR array_length(p_ordered_ids, 1) IS NULL THEN
    RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(p_tournament_id::text));

  -- Lock the target rows BEFORE validating so a concurrent
  -- start_match_atomic (row FOR UPDATE) serializes against this swap.
  PERFORM 1
  FROM public.matches
  WHERE id = ANY(p_ordered_ids)
  FOR UPDATE;

  IF EXISTS (
    SELECT 1
    FROM unnest(p_ordered_ids) AS t(id)
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.matches m
      WHERE m.id = t.id
        AND m.tournament_id = p_tournament_id
        AND m.status = 'pending'
    )
  ) THEN
    RAISE EXCEPTION 'swap_pending_match_numbers: one or more ids are not pending matches of tournament %', p_tournament_id;
  END IF;

  SELECT array_agg(m.match_number ORDER BY m.match_number)
  INTO v_sorted_nums
  FROM public.matches m
  WHERE m.id = ANY(p_ordered_ids);

  -- Pass 1: shift targets out of reach using +1000000 offset.
  -- Real match_number values per tournament are bounded well below this,
  -- so no UNIQUE collision is possible regardless of sign.
  FOR v_i IN 1 .. array_length(p_ordered_ids, 1) LOOP
    UPDATE public.matches
    SET match_number = match_number + 1000000
    WHERE id = p_ordered_ids[v_i];
  END LOOP;

  -- Pass 2: assign sorted match_numbers in caller-supplied order.
  FOR v_i IN 1 .. array_length(p_ordered_ids, 1) LOOP
    UPDATE public.matches
    SET match_number = v_sorted_nums[v_i]
    WHERE id = p_ordered_ids[v_i];
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.swap_pending_match_numbers(uuid, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.swap_pending_match_numbers(uuid, uuid[]) TO service_role;
