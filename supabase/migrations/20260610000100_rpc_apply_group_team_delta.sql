-- M1 — group_teams atomic increment RPC.
-- Closes the lost-update race in updateGroupTeamStandings/reverseGroupTeamStandings
-- (matches.ts): the old path SELECTed the row then UPDATEd with a JS-computed value,
-- so two concurrent score recordings on matches in the SAME group could both read the
-- same baseline and one overwrote the other. A single UPDATE with col = col + delta is
-- atomic per statement; GREATEST(0, …) floors both directions (matches the old
-- Math.max(0, …) on reversal; forward deltas are non-negative so the floor is a no-op).
CREATE OR REPLACE FUNCTION public.apply_group_team_delta(
  p_group_id uuid, p_team_id uuid,
  p_dwins int, p_ddraws int, p_dlosses int, p_dpf int, p_dpa int
) RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
  UPDATE public.group_teams SET
    wins=GREATEST(0,wins+p_dwins), draws=GREATEST(0,draws+p_ddraws),
    losses=GREATEST(0,losses+p_dlosses), points_for=GREATEST(0,points_for+p_dpf),
    points_against=GREATEST(0,points_against+p_dpa)
  WHERE group_id=p_group_id AND team_id=p_team_id;
$$;
REVOKE ALL ON FUNCTION public.apply_group_team_delta(uuid,uuid,int,int,int,int,int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_group_team_delta(uuid,uuid,int,int,int,int,int) TO service_role;
