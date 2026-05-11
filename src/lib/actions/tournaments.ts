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

const PRESET_COLORS = ["#ef4444", "#3b82f6", "#22c55e", "#f59e0b", "#a855f7", "#ec4899", "#14b8a6", "#f97316"];

async function ensureTeams(
  sb: Awaited<ReturnType<typeof createAdminClient>>,
  tournamentId: string,
  rows: Array<{ team: string; color?: string }>
) {
  const { data: existing } = await sb.from("teams").select("id, name").eq("tournament_id", tournamentId);
  const teamByName = new Map(existing?.map((t) => [t.name, t.id]) ?? []);
  let colorIdx = teamByName.size;

  for (const r of rows) {
    if (teamByName.has(r.team)) continue;
    const color = r.color || PRESET_COLORS[colorIdx % PRESET_COLORS.length];
    const { data } = await sb.from("teams").insert({ tournament_id: tournamentId, name: r.team, color }).select("id").single();
    if (data) { teamByName.set(r.team, data.id); colorIdx++; }
  }

  return teamByName;
}

// ── Step 1: Import players ────────────────────────────────────────────────────

export type PlayerCsvRow = {
  team: string;
  color: string;
  csv_id: string;        // user-defined stable ID (e.g. "G2-1a")
  display_name: string;
  role: "captain" | "member";
};

export async function importPlayersCsvAction(
  tournamentId: string,
  rows: PlayerCsvRow[]
): Promise<{ ok: true; teams: number; created: number; updated: number } | { error: string }> {
  const session = await getSession();
  if (!session) return await loginRedirect();

  const sb = await createAdminClient();
  const { data: t } = await sb.from("tournaments").select("owner_id").eq("id", tournamentId).single();
  if (!t || t.owner_id !== session.profileId) return { error: "ไม่มีสิทธิ์" };
  if (!rows.length) return { error: "ไม่มีข้อมูล" };

  const prevTeamCount = (await sb.from("teams").select("id", { count: "exact", head: true }).eq("tournament_id", tournamentId)).count ?? 0;
  const teamByName = await ensureTeams(sb, tournamentId, rows);
  const teamsCreated = teamByName.size - prevTeamCount;

  const allTeamIds = [...teamByName.values()];
  const { data: existingPlayers } = await sb
    .from("team_players").select("id, team_id, csv_id").in("team_id", allTeamIds);
  const existingByCsvId = new Map(
    existingPlayers?.filter((p) => p.csv_id).map((p) => [`${p.team_id}:${p.csv_id}`, p.id]) ?? []
  );

  let created = 0, updated = 0;
  for (const r of rows) {
    const teamId = teamByName.get(r.team);
    if (!teamId) continue;
    const existingId = existingByCsvId.get(`${teamId}:${r.csv_id}`);
    if (existingId) {
      // Upsert: update display_name + role
      await sb.from("team_players").update({ display_name: r.display_name, role: r.role }).eq("id", existingId);
      updated++;
    } else {
      await sb.from("team_players").insert({ team_id: teamId, csv_id: r.csv_id, display_name: r.display_name, role: r.role });
      created++;
    }
  }

  revalidatePath(`/tournaments/${tournamentId}`);
  return { ok: true, teams: teamsCreated, created, updated };
}

// ── Step 2: Import pairs ──────────────────────────────────────────────────────

export type PairCsvRow = {
  csv_id: string;       // matches csv_id from player import
  pair_name: string;
};

export async function importPairsCsvAction(
  tournamentId: string,
  rows: PairCsvRow[]
): Promise<{ ok: true; pairs: number; skipped: number } | { error: string }> {
  const session = await getSession();
  if (!session) return await loginRedirect();

  const sb = await createAdminClient();
  const { data: t } = await sb.from("tournaments").select("owner_id").eq("id", tournamentId).single();
  if (!t || t.owner_id !== session.profileId) return { error: "ไม่มีสิทธิ์" };
  if (!rows.length) return { error: "ไม่มีข้อมูล" };

  // Build csv_id → {player_id, team_id} map for this tournament
  const { data: players } = await sb
    .from("team_players")
    .select("id, team_id, csv_id")
    .not("csv_id", "is", null);

  const { data: teams } = await sb.from("teams").select("id").eq("tournament_id", tournamentId);
  const teamIdSet = new Set(teams?.map((t) => t.id) ?? []);

  const playerByCsvId = new Map<string, { id: string; teamId: string }>();
  for (const p of players ?? []) {
    if (p.csv_id && teamIdSet.has(p.team_id)) {
      playerByCsvId.set(p.csv_id, { id: p.id, teamId: p.team_id });
    }
  }

  // Existing pairs to prevent duplicates
  const allTeamIds = [...teamIdSet];
  const { data: existingPairs } = await sb.from("pairs").select("name, team_id").in("team_id", allTeamIds);
  const existingPairSet = new Set(existingPairs?.map((p) => `${p.team_id}:${p.name}`) ?? []);

  // Group by pair_name
  const groups = new Map<string, { teamId: string; pairName: string; playerIds: string[] }>();
  let skipped = 0;
  for (const r of rows) {
    if (!r.pair_name || !r.csv_id) continue;
    const player = playerByCsvId.get(r.csv_id);
    if (!player) { skipped++; continue; }
    const key = `${player.teamId}:${r.pair_name}`;
    if (!groups.has(key)) groups.set(key, { teamId: player.teamId, pairName: r.pair_name, playerIds: [] });
    groups.get(key)!.playerIds.push(player.id);
  }

  let pairsCreated = 0;
  for (const [key, g] of groups) {
    if (g.playerIds.length !== 2) { skipped++; continue; }
    if (existingPairSet.has(key)) { skipped++; continue; }
    const { data: pair } = await sb.from("pairs").insert({ team_id: g.teamId, name: g.pairName }).select("id").single();
    if (!pair) continue;
    const { error } = await sb.from("pair_players").insert([
      { pair_id: pair.id, player_id: g.playerIds[0] },
      { pair_id: pair.id, player_id: g.playerIds[1] },
    ]);
    if (!error) pairsCreated++;
  }

  revalidatePath(`/tournaments/${tournamentId}`);
  return { ok: true, pairs: pairsCreated, skipped };
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
