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
  playerIds: string[]; // length 2
  name?: string;
}) {
  const session = await getSession();
  if (!session) return await loginRedirect();

  if (input.playerIds.length !== 2) return { error: "ต้องเลือก 2 คน" };

  const tournamentId = await tournamentIdOfTeam(input.teamId);
  if (!tournamentId) return { error: "ไม่พบทีม" };
  if (!(await assertTournamentOwner(tournamentId, session.profileId))) return { error: "ไม่มีสิทธิ์" };

  const sb = await createAdminClient();

  // Check players belong to this team
  const { data: players } = await sb
    .from("team_players")
    .select("id, team_id")
    .in("id", input.playerIds);
  if (!players || players.length !== 2 || players.some((p) => p.team_id !== input.teamId)) {
    return { error: "ผู้เล่นไม่ได้อยู่ในทีมนี้" };
  }

  // Create pair
  const { data: pair, error } = await sb
    .from("pairs")
    .insert({ team_id: input.teamId, name: input.name || null })
    .select("id")
    .single();
  if (error || !pair) return { error: error?.message ?? "สร้างคู่ไม่สำเร็จ" };

  const { error: ppErr } = await sb
    .from("pair_players")
    .insert(input.playerIds.map((pid) => ({ pair_id: pair.id, player_id: pid })));

  if (ppErr) {
    await sb.from("pairs").delete().eq("id", pair.id);
    if (ppErr.code === "23505") return { error: "ผู้เล่นบางคนถูกจับคู่ไว้แล้ว" };
    return { error: ppErr.message };
  }

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
