-- Hardening — strip anon/authenticated/PUBLIC EXECUTE from app RPCs.
-- Found during the 2026-06-10 M1-M3 post-apply verify: Supabase's default
-- privileges grant EXECUTE on new public functions to anon + authenticated,
-- and `REVOKE ... FROM PUBLIC` alone does not undo those role-specific grants.
-- 4 older RPCs shipped with the same gap (create_club_locked_pair even kept the
-- PUBLIC grant). Not exploitable today — every touched table has RLS enabled
-- with SELECT-only policies, so anon-invoked SECURITY INVOKER writes hit 0 rows
-- or error — but the project invariant is "RPCs executable by service_role
-- only"; this restores it as defense-in-depth.
-- (record_match_score / reorder_tournament_queue / swap_pending_match_numbers /
-- replace_tournament_matches / regenerate_tournament_groups were verified
-- already service_role-only.)

-- New this round (M1-M3)
REVOKE EXECUTE ON FUNCTION public.apply_group_team_delta(uuid,uuid,int,int,int,int,int) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.add_club_player(uuid,text,uuid,text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.bump_session_version(uuid) FROM PUBLIC, anon, authenticated;

-- Pre-existing gap (club RPCs + Phase 12 start_match_atomic)
REVOKE EXECUTE ON FUNCTION public.finish_club_match(uuid,text,int,int) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.delete_club_match(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.create_club_locked_pair(uuid,uuid,uuid,int) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.remove_club_player_and_promote(uuid,uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.start_match_atomic(uuid,uuid[]) FROM PUBLIC, anon, authenticated;
