"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/auth/session";
import { assertCanEdit } from "@/lib/tournament/permissions";
import { writeAuditLog } from "@/lib/tournament/audit";

async function loginRedirect(): Promise<never> {
  const h = await headers();
  const referer = h.get("referer");
  const redirectTo = referer ? new URL(referer).pathname : "/tournaments";
  redirect(`/?auth_error=login_required&redirectTo=${encodeURIComponent(redirectTo)}`);
}

function computePairLevel(l1: string | null | undefined, l2: string | null | undefined): string | null {
  const n1 = parseFloat(l1 ?? "");
  const n2 = parseFloat(l2 ?? "");
  if (isNaN(n1) && isNaN(n2)) return null;
  return String((isNaN(n1) ? 0 : n1) + (isNaN(n2) ? 0 : n2));
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
}) {
  const session = await getSession();
  if (!session) return await loginRedirect();

  const tournamentId = await tournamentIdOfTeam(input.teamId);
  if (!tournamentId) return { error: "ไม่พบทีม" };
  if (!(await assertCanEdit(tournamentId, session.profileId))) return { error: "ไม่มีสิทธิ์" };

  const sb = await createAdminClient();

  // Verify both players belong to this team + get levels for auto-compute
  const { data: players } = await sb
    .from("team_players").select("id, team_id, level").in("id", input.playerIds);
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

  const p1data = players.find((p) => p.id === input.playerIds[0]);
  const p2data = players.find((p) => p.id === input.playerIds[1]);

  const { error } = await sb.from("pairs").insert({
    team_id: input.teamId,
    player_id_1: input.playerIds[0],
    player_id_2: input.playerIds[1],
    display_pair_name: input.name || null,
    pair_level: computePairLevel(p1data?.level, p2data?.level),
  });
  if (error) return { error: "สร้างคู่ไม่สำเร็จ" };

  revalidatePath(`/tournaments/${tournamentId}`);
  await writeAuditLog({
    tournament_id: tournamentId,
    actor_id: session.profileId,
    actor_name: session.displayName,
    event_type: "pair_created",
    entity_type: "pair",
    description: `สร้างคู่ใหม่`,
  });
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
  if (!(await assertCanEdit(tournamentId, session.profileId))) return { error: "ไม่มีสิทธิ์" };

  await sb.from("pairs").delete().eq("id", pairId);
  revalidatePath(`/tournaments/${tournamentId}`);
  await writeAuditLog({
    tournament_id: tournamentId,
    actor_id: session.profileId,
    actor_name: session.displayName,
    event_type: "pair_deleted",
    entity_type: "pair",
    entity_id: pairId,
    description: `ลบคู่`,
  });
  return { ok: true };
}
