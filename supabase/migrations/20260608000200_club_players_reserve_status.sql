-- Club reserve/waitlist: players added beyond the club's max_players cap become
-- "reserve". When an active player leaves, the earliest reserve auto-promotes.
--
-- 1) status column (additive, default 'active' so every existing row stays active).
ALTER TABLE public.club_players
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active'
  CHECK (status IN ('active', 'reserve'));

-- Fast lookup of a club's active count + earliest reserve.
CREATE INDEX IF NOT EXISTS idx_club_players_club_status_position
  ON public.club_players (club_id, status, position);

-- 2) Atomic remove + promote. Deleting via this RPC (instead of a bare DELETE)
--    frees a slot and pulls up the earliest-queued reserve in one transaction,
--    so two concurrent removals can't promote the same reserve twice.
CREATE OR REPLACE FUNCTION public.remove_club_player_and_promote(
  p_player_id uuid,
  p_club_id   uuid
)
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
  -- Scope guard: caller's club must own the player (mirrors the old
  -- DELETE ... WHERE id = ? AND club_id = ? safety).
  IF v_club_id IS DISTINCT FROM p_club_id THEN
    RETURN;
  END IF;

  -- CASCADE on club_matches / club_locked_pairs cleans up the player's rows.
  DELETE FROM public.club_players WHERE id = p_player_id;

  SELECT max_players INTO v_max FROM public.clubs WHERE id = v_club_id;
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

REVOKE EXECUTE ON FUNCTION public.remove_club_player_and_promote(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.remove_club_player_and_promote(uuid, uuid) TO service_role;
