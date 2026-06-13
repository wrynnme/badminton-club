-- P2 hardening from the whole-system club code-review (two RPCs).
--
-- 1) remove_club_player_and_promote: locked only the leaving player row + the
--    promoted reserve, NOT the clubs row. add_club_player takes a clubs-row
--    FOR UPDATE lock before counting active vs max, so the two paths guarding
--    the `active <= max_players` invariant didn't share a lock and could
--    interleave to overshoot the cap. Take the same clubs-row lock here (early,
--    before the count) so both serialize. Lock order is add: clubs→insert;
--    remove: player→clubs — no cycle (add inserts a new row, never waits on the
--    existing player row), so no deadlock.
--
-- 2) clone_global_levels_to_club: was SECURITY DEFINER for no benefit — it only
--    writes levels + club_players, which the service-role caller already has
--    grants on + BYPASSRLS. DEFINER (runs as table owner) is a privilege-
--    escalation surface if its EXECUTE grant is ever loosened. Switch to
--    SECURITY INVOKER: an anon caller (hypothetically granted EXECUTE) would run
--    as anon and its writes would be denied (no grant after the RLS lockdown),
--    while the legitimate service-role path is unchanged.
--
-- Both are CREATE OR REPLACE (no data change, backward-compatible with running code).

CREATE OR REPLACE FUNCTION public.remove_club_player_and_promote(p_player_id uuid, p_club_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_club_id uuid;
  v_max     int;
  v_active  int;
  v_promote uuid;
BEGIN
  SELECT club_id INTO v_club_id
    FROM public.club_players
    WHERE id = p_player_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RETURN; -- already gone (idempotent)
  END IF;
  -- Scope guard: caller's club must own the player.
  IF v_club_id IS DISTINCT FROM p_club_id THEN
    RETURN;
  END IF;

  -- Lock the club row so the active-count + promote decision serializes with
  -- add_club_player (which takes the same lock) — prevents the active cap from
  -- being overshot when an add and a remove+promote interleave.
  SELECT max_players INTO v_max FROM public.clubs WHERE id = v_club_id FOR UPDATE;

  -- CASCADE on club_matches / club_locked_pairs cleans up the player's rows.
  DELETE FROM public.club_players WHERE id = p_player_id;

  SELECT count(*) INTO v_active
    FROM public.club_players
    WHERE club_id = v_club_id AND status = 'active';

  IF v_active < v_max THEN
    SELECT id INTO v_promote
      FROM public.club_players
      WHERE club_id = v_club_id AND status = 'reserve'
      ORDER BY position ASC NULLS LAST, joined_at ASC
      LIMIT 1
      FOR UPDATE;
    IF v_promote IS NOT NULL THEN
      UPDATE public.club_players SET status = 'active' WHERE id = v_promote;
    END IF;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.clone_global_levels_to_club(p_club_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
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

-- Re-assert service-role-only EXECUTE (CREATE OR REPLACE can re-apply default grants).
REVOKE EXECUTE ON FUNCTION public.remove_club_player_and_promote(uuid,uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.clone_global_levels_to_club(uuid) FROM PUBLIC, anon, authenticated;
