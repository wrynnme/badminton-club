-- Per-club skill levels — RPC: copy-on-first-write clone helper.
-- When a club first customizes its level ladder, this function:
--   1. Copies every global level (club_id IS NULL) into club-scoped rows.
--   2. Remaps that club's club_players.level_id from the global row to the
--      corresponding new club-scoped row (matched by label) — atomically in one CTE.
-- Idempotent: if the club already has any club-scoped rows, returns immediately.
-- Must be called via service_role only (REVOKE below enforces this).
CREATE OR REPLACE FUNCTION public.clone_global_levels_to_club(p_club_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int;
BEGIN
  SELECT count(*) INTO v_count FROM public.levels WHERE club_id = p_club_id;
  IF v_count > 0 THEN
    RETURN;  -- already customized, nothing to do
  END IF;

  WITH ins AS (
    INSERT INTO public.levels (club_id, "real", label, sort_order)
    SELECT p_club_id, "real", label, sort_order
    FROM public.levels
    WHERE club_id IS NULL
    RETURNING id AS new_id, label
  )
  UPDATE public.club_players cp
  SET level_id = ins.new_id
  FROM ins
  JOIN public.levels g ON g.label = ins.label AND g.club_id IS NULL
  WHERE cp.club_id   = p_club_id
    AND cp.level_id  = g.id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.clone_global_levels_to_club(uuid) FROM PUBLIC, anon, authenticated;
