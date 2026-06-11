"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { getTranslations } from "next-intl/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/auth/session";
import { assertCanEdit } from "@/lib/tournament/permissions";
import { writeAuditLog } from "@/lib/tournament/audit";
import { pairLevelString, embeddedReal } from "@/lib/tournament/levels";

async function loginRedirect(): Promise<never> {
  const h = await headers();
  const referer = h.get("referer");
  const redirectTo = referer ? new URL(referer).pathname : "/tournaments";
  redirect(`/?auth_error=login_required&redirectTo=${encodeURIComponent(redirectTo)}`);
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
  classId?: string;
}) {
  const session = await getSession();
  if (!session) return await loginRedirect();
  const t = await getTranslations("actions");

  const tournamentId = await tournamentIdOfTeam(input.teamId);
  if (!tournamentId) return { error: t("tournament.teamNotFound") };
  if (!(await assertCanEdit(tournamentId, session.profileId))) return { error: t("tournament.noPermission") };

  const sb = await createAdminClient();

  // Validate class belongs to this tournament (if provided)
  if (input.classId) {
    const { data: cls } = await sb
      .from("tournament_classes")
      .select("id")
      .eq("id", input.classId)
      .eq("tournament_id", tournamentId)
      .maybeSingle();
    if (!cls) return { error: t("tournament.classNotFound") };
  }

  // Verify both players belong to this team + get level embeds for auto-compute
  const { data: players } = await sb
    .from("team_players").select("id, team_id, level_id, levels:level_id(real)").in("id", input.playerIds);
  if (!players || players.length !== 2 || players.some((p) => p.team_id !== input.teamId)) {
    return { error: t("tournament.playersNotInTeam") };
  }

  // Check neither player is already in a pair in this team
  const { data: existing } = await sb
    .from("pairs")
    .select("id")
    .eq("team_id", input.teamId)
    .or(`player_id_1.eq.${input.playerIds[0]},player_id_2.eq.${input.playerIds[0]},player_id_1.eq.${input.playerIds[1]},player_id_2.eq.${input.playerIds[1]}`);
  if (existing?.length) return { error: t("tournament.playerAlreadyPaired") };

  const p1data = players.find((p) => p.id === input.playerIds[0]);
  const p2data = players.find((p) => p.id === input.playerIds[1]);

  const { error } = await sb.from("pairs").insert({
    team_id: input.teamId,
    player_id_1: input.playerIds[0],
    player_id_2: input.playerIds[1],
    display_pair_name: input.name || null,
    pair_level: pairLevelString(
      embeddedReal((p1data as unknown as { levels: unknown })?.levels),
      embeddedReal((p2data as unknown as { levels: unknown })?.levels),
    ),
    class_id: input.classId || null,
  });
  if (error) return { error: t("tournament.createPairFailed") };

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
  const t = await getTranslations("actions");

  const sb = await createAdminClient();
  const { data: pair } = await sb
    .from("pairs")
    .select("team_id, teams!inner(tournament_id)")
    .eq("id", pairId)
    .single();

  if (!pair) return { error: t("tournament.pairNotFound") };
  const tournamentId = (pair.teams as unknown as { tournament_id: string }).tournament_id;
  if (!(await assertCanEdit(tournamentId, session.profileId))) return { error: t("tournament.noPermission") };

  const { error: deleteError } = await sb.from("pairs").delete().eq("id", pairId);
  if (deleteError) return { error: t("tournament.deletePairFailed") };
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
