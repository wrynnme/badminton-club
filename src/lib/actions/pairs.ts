"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/auth/session";

async function loginRedirect(): Promise<never> {
  const h = await headers();
  const referer = h.get("referer");
  const redirectTo = referer ? new URL(referer).pathname : "/tournaments";
  redirect(`/?auth_error=login_required&redirectTo=${encodeURIComponent(redirectTo)}`);
}

async function assertTournamentOwner(tournamentId: string, profileId: string): Promise<boolean> {
  const sb = await createAdminClient();
  const { data } = await sb.from("tournaments").select("owner_id").eq("id", tournamentId).single();
  return data?.owner_id === profileId;
}

async function tournamentIdOfTeam(teamId: string): Promise<string | null> {
  const sb = await createAdminClient();
  const { data } = await sb.from("teams").select("tournament_id").eq("id", teamId).single();
  return data?.tournament_id ?? null;
}

export async function createPairAction(input: {
  teamId: string;
  playerIds: [string, string];
  name?: string;
  pairLevel?: string;
  pairCode?: string;
}) {
  const session = await getSession();
  if (!session) return await loginRedirect();

  const tournamentId = await tournamentIdOfTeam(input.teamId);
  if (!tournamentId) return { error: "ไม่พบทีม" };
  if (!(await assertTournamentOwner(tournamentId, session.profileId))) return { error: "ไม่มีสิทธิ์" };

  const sb = await createAdminClient();

  // Verify both players belong to this team
  const { data: players } = await sb
    .from("team_players").select("id, team_id").in("id", input.playerIds);
  if (!players || players.length !== 2 || players.some((p) => p.team_id !== input.teamId)) {
    return { error: "ผู้เล่นไม่ได้อยู่ในทีมนี้" };
  }

  // Check neither player is already in a pair in this team
  const { data: existing } = await sb
    .from("pairs")
    .select("id")
    .eq("team_id", input.teamId)
    .or(`player_id_1.eq.${input.playerIds[0]},player_id_2.eq.${input.playerIds[0]},player_id_1.eq.${input.playerIds[1]},player_id_2.eq.${input.playerIds[1]}`);
  if (existing?.length) return { error: "ผู้เล่นบางคนถูกจับคู่ไว้แล้ว" };

  const { error } = await sb.from("pairs").insert({
    team_id: input.teamId,
    player_id_1: input.playerIds[0],
    player_id_2: input.playerIds[1],
    display_pair_name: input.name || null,
    pair_level: input.pairLevel || null,
    pair_code: input.pairCode || null,
  });
  if (error) return { error: error.message };

  revalidatePath(`/tournaments/${tournamentId}`);
  return { ok: true };
}

export async function deletePairAction(pairId: string) {
  const session = await getSession();
  if (!session) return await loginRedirect();

  const sb = await createAdminClient();
  const { data: pair } = await sb
    .from("pairs")
    .select("team_id, teams!inner(tournament_id)")
    .eq("id", pairId)
    .single();

  if (!pair) return { error: "ไม่พบคู่" };
  const tournamentId = (pair.teams as unknown as { tournament_id: string }).tournament_id;
  if (!(await assertTournamentOwner(tournamentId, session.profileId))) return { error: "ไม่มีสิทธิ์" };

  await sb.from("pairs").delete().eq("id", pairId);
  revalidatePath(`/tournaments/${tournamentId}`);
  return { ok: true };
}
