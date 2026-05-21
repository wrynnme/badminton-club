-- RPC: swap_pending_match_numbers
-- Reorders pending matches by swapping their match_number values among
-- themselves. in_progress and completed rows are never touched.
-- Two-pass write with +1000000 offset avoids UNIQUE collisions during the
-- swap regardless of whether any existing match_number is negative.

CREATE OR REPLACE FUNCTION public.swap_pending_match_numbers(
  p_tournament_id uuid,
  p_ordered_ids   uuid[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_sorted_nums integer[];
  v_i           integer;
BEGIN
  -- Early-exit guard: NULL or empty array is a no-op (not an error).
  IF p_ordered_ids IS NULL OR array_length(p_ordered_ids, 1) IS NULL THEN
    RETURN;
  END IF;

  -- Advisory lock scoped to this transaction to serialise concurrent callers.
  PERFORM pg_advisory_xact_lock(hashtext(p_tournament_id::text));

  -- Validate: every supplied id must belong to the tournament AND be pending.
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

  -- Collect current match_number values for the target rows, sorted ASC.
  SELECT array_agg(m.match_number ORDER BY m.match_number)
  INTO v_sorted_nums
  FROM public.matches m
  WHERE m.id = ANY(p_ordered_ids);

  -- Pass 1: shift targets out of reach using +1000000 offset.
  -- Real match_number values per tournament are bounded well below 1M,
  -- so no UNIQUE collision is possible regardless of sign.
  FOR v_i IN 1 .. array_length(p_ordered_ids, 1) LOOP
    UPDATE public.matches
    SET match_number = match_number + 1000000
    WHERE id = p_ordered_ids[v_i];
  END LOOP;

  -- Pass 2: assign the sorted match_numbers in caller-supplied order.
  -- p_ordered_ids[1] → smallest number, p_ordered_ids[2] → next, …
  FOR v_i IN 1 .. array_length(p_ordered_ids, 1) LOOP
    UPDATE public.matches
    SET match_number = v_sorted_nums[v_i]
    WHERE id = p_ordered_ids[v_i];
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.swap_pending_match_numbers(uuid, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.swap_pending_match_numbers(uuid, uuid[]) TO service_role;
