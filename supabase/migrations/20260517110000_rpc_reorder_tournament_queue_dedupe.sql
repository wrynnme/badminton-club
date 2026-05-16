-- Re-issue reorder_tournament_queue with duplicate-id rejection.
-- Prior version compared v_count vs COUNT(*), which surfaced a misleading
-- "matchId not in tournament" error when the caller sent duplicates.

CREATE OR REPLACE FUNCTION public.reorder_tournament_queue(
  p_tournament_id uuid,
  p_ordered_ids uuid[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_count int;
  v_distinct_count int;
  v_tournament_count int;
  i int;
BEGIN
  v_count := COALESCE(array_length(p_ordered_ids, 1), 0);
  IF v_count = 0 THEN
    RETURN;
  END IF;

  SELECT cardinality(ARRAY(SELECT DISTINCT unnest(p_ordered_ids))) INTO v_distinct_count;
  IF v_distinct_count <> v_count THEN
    RAISE EXCEPTION 'duplicate matchId in ordered list' USING ERRCODE = '22023';
  END IF;

  SELECT COUNT(*) INTO v_tournament_count
  FROM public.matches
  WHERE tournament_id = p_tournament_id AND id = ANY (p_ordered_ids);

  IF v_tournament_count <> v_count THEN
    RAISE EXCEPTION 'matchId not in tournament' USING ERRCODE = '22023';
  END IF;

  PERFORM 1 FROM public.matches
  WHERE tournament_id = p_tournament_id AND id = ANY (p_ordered_ids)
  FOR UPDATE;

  UPDATE public.matches
  SET queue_position = NULL
  WHERE tournament_id = p_tournament_id AND id = ANY (p_ordered_ids);

  FOR i IN 1 .. v_count LOOP
    UPDATE public.matches
    SET queue_position = i
    WHERE tournament_id = p_tournament_id AND id = p_ordered_ids[i];
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.reorder_tournament_queue(uuid, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reorder_tournament_queue(uuid, uuid[]) TO service_role;
