"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/auth/session";

async function loginRedirect(): Promise<never> {
  const h = await headers();
  const referer = h.get("referer");
  let redirectTo = "/tournaments";
  if (referer) {
    try {
      const url = new URL(referer);
      if (url.pathname !== "/") redirectTo = url.pathname + url.search;
    } catch {}
  }
  redirect(`/?auth_error=login_required&redirectTo=${encodeURIComponent(redirectTo)}`);
}

const TournamentSchema = z.object({
  name: z.string().min(2, "ชื่อทัวร์นาเมนต์สั้นไป"),
  venue: z.string().optional(),
  start_date: z.string().optional(),
  end_date: z.string().optional(),
  format: z.enum(["group_only", "group_knockout", "knockout_only"]),
  match_unit: z.enum(["team", "pair"]).default("team"),
  has_lower_bracket: z.boolean().default(false),
  allow_drop_to_lower: z.boolean().default(false),
  seeding_method: z.enum(["random", "by_group_score"]).default("random"),
  advance_count: z.number().int().min(1).max(8).default(2),
  team_count: z.number().int().min(2).max(64),
  notes: z.string().optional(),
});

export type CreateTournamentInput = z.infer<typeof TournamentSchema>;

export async function createTournamentAction(input: CreateTournamentInput) {
  const session = await getSession();
  if (!session) return await loginRedirect();

  const parsed = TournamentSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };
  }

  const sb = await createAdminClient();
  const { data, error } = await sb
    .from("tournaments")
    .insert({ ...parsed.data, mode: "sports_day", owner_id: session.profileId })
    .select("id")
    .single();

  if (error || !data) return { error: error?.message ?? "สร้างไม่สำเร็จ" };

  revalidatePath("/tournaments");
  redirect(`/tournaments/${data.id}`);
}

export async function updateTournamentAction(input: CreateTournamentInput & { id: string }) {
  const session = await getSession();
  if (!session) return await loginRedirect();

  const { id, ...rest } = input;
  const parsed = TournamentSchema.safeParse(rest);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };
  }

  const sb = await createAdminClient();
  const { data: t } = await sb.from("tournaments").select("owner_id").eq("id", id).single();
  if (!t || t.owner_id !== session.profileId) return { error: "ไม่มีสิทธิ์" };

  const { error } = await sb.from("tournaments").update(parsed.data).eq("id", id);
  if (error) return { error: error.message };

  revalidatePath(`/tournaments/${id}`);
  return { ok: true };
}

export async function updateTournamentStatusAction(id: string, status: "draft" | "registering" | "ongoing" | "completed") {
  const session = await getSession();
  if (!session) return await loginRedirect();

  const sb = await createAdminClient();
  const { data: t } = await sb.from("tournaments").select("owner_id").eq("id", id).single();
  if (!t || t.owner_id !== session.profileId) return { error: "ไม่มีสิทธิ์" };

  const { error } = await sb.from("tournaments").update({ status }).eq("id", id);
  if (error) return { error: error.message };

  revalidatePath(`/tournaments/${id}`);
  return { ok: true };
}

const TeamSchema = z.object({
  tournament_id: z.string().uuid(),
  name: z.string().min(1, "ระบุชื่อทีม"),
  color: z.string().optional(),
});

export type CreateTeamInput = z.infer<typeof TeamSchema>;

export async function createTeamAction(input: CreateTeamInput) {
  const session = await getSession();
  if (!session) return await loginRedirect();

  const parsed = TeamSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };

  const sb = await createAdminClient();
  const { data: t } = await sb.from("tournaments").select("owner_id").eq("id", parsed.data.tournament_id).single();
  if (!t || t.owner_id !== session.profileId) return { error: "ไม่มีสิทธิ์" };

  const { error } = await sb.from("teams").insert(parsed.data);
  if (error) return { error: error.message };

  revalidatePath(`/tournaments/${parsed.data.tournament_id}`);
  return { ok: true };
}

export async function deleteTeamAction(teamId: string, tournamentId: string) {
  const session = await getSession();
  if (!session) return await loginRedirect();

  const sb = await createAdminClient();
  const { data: t } = await sb.from("tournaments").select("owner_id").eq("id", tournamentId).single();
  if (!t || t.owner_id !== session.profileId) return { error: "ไม่มีสิทธิ์" };

  await sb.from("teams").delete().eq("id", teamId);
  revalidatePath(`/tournaments/${tournamentId}`);
  return { ok: true };
}

export async function addTeamPlayerAction(input: { team_id: string; display_name: string; role: "captain" | "member"; tournament_id: string }) {
  const session = await getSession();
  if (!session) return await loginRedirect();

  const sb = await createAdminClient();
  const { data: t } = await sb.from("tournaments").select("owner_id").eq("id", input.tournament_id).single();
  if (!t || t.owner_id !== session.profileId) return { error: "ไม่มีสิทธิ์" };

  const { error } = await sb.from("team_players").insert({
    team_id: input.team_id,
    display_name: input.display_name,
    role: input.role,
    profile_id: session.profileId,
  });
  if (error) return { error: error.message };

  revalidatePath(`/tournaments/${input.tournament_id}`);
  return { ok: true };
}

export async function removeTeamPlayerAction(playerId: string, tournamentId: string) {
  const session = await getSession();
  if (!session) return await loginRedirect();

  const sb = await createAdminClient();
  const { data: t } = await sb.from("tournaments").select("owner_id").eq("id", tournamentId).single();
  if (!t || t.owner_id !== session.profileId) return { error: "ไม่มีสิทธิ์" };

  await sb.from("team_players").delete().eq("id", playerId);
  revalidatePath(`/tournaments/${tournamentId}`);
  return { ok: true };
}

// ============ CSV IMPORT ============

export type CsvRow = {
  team: string;
  color: string;
  display_name: string;
  role: "captain" | "member";
  pair_name: string;
};

const PRESET_COLORS = ["#ef4444", "#3b82f6", "#22c55e", "#f59e0b", "#a855f7", "#ec4899", "#14b8a6", "#f97316"];

export async function importTournamentCsvAction(
  tournamentId: string,
  rows: CsvRow[]
): Promise<{ ok: true; teams: number; players: number; pairs: number } | { error: string }> {
  const session = await getSession();
  if (!session) return await loginRedirect();

  const sb = await createAdminClient();
  const { data: tournament } = await sb
    .from("tournaments")
    .select("owner_id, match_unit")
    .eq("id", tournamentId)
    .single();
  if (!tournament || tournament.owner_id !== session.profileId) return { error: "ไม่มีสิทธิ์" };
  if (!rows.length) return { error: "ไม่มีข้อมูล" };

  // 1. Collect unique teams (preserve order of first occurrence)
  const uniqueTeamNames: string[] = [];
  const teamColorMap = new Map<string, string>();
  for (const r of rows) {
    if (!uniqueTeamNames.includes(r.team)) {
      uniqueTeamNames.push(r.team);
      if (r.color) teamColorMap.set(r.team, r.color);
    }
  }

  // 2. Fetch existing teams
  const { data: existingTeams } = await sb
    .from("teams").select("id, name").eq("tournament_id", tournamentId);
  const teamByName = new Map(existingTeams?.map((t) => [t.name, t.id]) ?? []);

  // 3. Create missing teams (auto-assign color if not specified)
  let colorIdx = teamByName.size;
  let teamsCreated = 0;
  for (const name of uniqueTeamNames) {
    if (!teamByName.has(name)) {
      const color = teamColorMap.get(name) ?? PRESET_COLORS[colorIdx % PRESET_COLORS.length];
      const { data } = await sb
        .from("teams").insert({ tournament_id: tournamentId, name, color }).select("id").single();
      if (data) { teamByName.set(name, data.id); colorIdx++; teamsCreated++; }
    }
  }

  const allTeamIds = [...teamByName.values()];

  // 4. Insert every row as a new player (no dedup by name — ID is the unique key)
  // Pairs match by row position in the group, not by name lookup
  const rowPlayerIds: (string | null)[] = new Array(rows.length).fill(null);
  let playersCreated = 0;

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const teamId = teamByName.get(r.team);
    if (!teamId) continue;
    const { data } = await sb
      .from("team_players")
      .insert({ team_id: teamId, display_name: r.display_name, role: r.role })
      .select("id")
      .single();
    if (data) { rowPlayerIds[i] = data.id; playersCreated++; }
  }

  // 5. Create pairs — group by (team, pair_name) using row-level player IDs
  let pairsCreated = 0;
  if (tournament.match_unit === "pair" && rows.some((r) => r.pair_name)) {
    const { data: existingPairs } = await sb
      .from("pairs").select("id, name, team_id").in("team_id", allTeamIds);
    const existingPairSet = new Set(existingPairs?.map((p) => `${p.team_id}:${p.name}`) ?? []);

    const pairGroups = new Map<string, { teamId: string; pairName: string; playerIds: string[] }>();
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (!r.pair_name) continue;
      const teamId = teamByName.get(r.team);
      const playerId = rowPlayerIds[i];
      if (!teamId || !playerId) continue;
      const key = `${teamId}:${r.pair_name}`;
      if (!pairGroups.has(key)) pairGroups.set(key, { teamId, pairName: r.pair_name, playerIds: [] });
      pairGroups.get(key)!.playerIds.push(playerId);
    }

    for (const [key, g] of pairGroups) {
      if (g.playerIds.length !== 2 || existingPairSet.has(key)) continue;
      const { data: pair } = await sb
        .from("pairs").insert({ team_id: g.teamId, name: g.pairName }).select("id").single();
      if (!pair) continue;
      await sb.from("pair_players").insert([
        { pair_id: pair.id, player_id: g.playerIds[0] },
        { pair_id: pair.id, player_id: g.playerIds[1] },
      ]);
      pairsCreated++;
    }
  }

  revalidatePath(`/tournaments/${tournamentId}`);
  return { ok: true, teams: teamsCreated, players: playersCreated, pairs: pairsCreated };
}

export async function updateTeamPlayerAction(
  playerId: string,
  display_name: string,
  tournamentId: string
) {
  const session = await getSession();
  if (!session) return await loginRedirect();

  const sb = await createAdminClient();
  const { data: t } = await sb.from("tournaments").select("owner_id").eq("id", tournamentId).single();
  if (!t || t.owner_id !== session.profileId) return { error: "ไม่มีสิทธิ์" };

  if (!display_name.trim()) return { error: "ชื่อห้ามว่าง" };

  const { error } = await sb
    .from("team_players").update({ display_name: display_name.trim() }).eq("id", playerId);
  if (error) return { error: error.message };

  revalidatePath(`/tournaments/${tournamentId}`);
  return { ok: true };
}
