-- RPC: swap_pending_match_numbers
-- Reorders pending matches by swapping their match_number values among
-- themselves. in_progress and completed rows are never touched.
-- Two-pass write avoids UNIQUE collisions during the swap.

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
  v_id          uuid;
  v_sorted_nums integer[];
  v_tmp_nums    integer[];
  v_i           integer;
BEGIN
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

  -- Pass 1: assign temporary negative placeholders to dodge UNIQUE conflicts.
  FOR v_i IN 1 .. array_length(p_ordered_ids, 1) LOOP
    UPDATE public.matches
    SET match_number = -v_i
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
