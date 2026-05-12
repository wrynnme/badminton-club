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
  pair_division_threshold: z.number().nullable().optional(),
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

export async function addTeamPlayerAction(input: { team_id: string; display_name: string; role: "captain" | "member"; level?: string; tournament_id: string }) {
  const session = await getSession();
  if (!session) return await loginRedirect();

  const sb = await createAdminClient();
  const { data: t } = await sb.from("tournaments").select("owner_id").eq("id", input.tournament_id).single();
  if (!t || t.owner_id !== session.profileId) return { error: "ไม่มีสิทธิ์" };

  const { error } = await sb.from("team_players").insert({
    team_id: input.team_id,
    display_name: input.display_name,
    role: input.role,
    level: input.level || null,
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
  level: string;
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
      await sb.from("team_players").update({ display_name: r.display_name, role: r.role, level: r.level || null }).eq("id", existingId);
      updated++;
    } else {
      await sb.from("team_players").insert({ team_id: teamId, csv_id: r.csv_id, display_name: r.display_name, role: r.role, level: r.level || null });
      created++;
    }
  }

  revalidatePath(`/tournaments/${tournamentId}`);
  return { ok: true, teams: teamsCreated, created, updated };
}

// ── Step 2: Import pairs ──────────────────────────────────────────────────────

export type PairCsvRow = {
  team: string;         // team name (informational, for readability)
  pair_code: string;    // stable pair ID for upsert
  id_player_1: string;  // csv_id of first player
  id_player_2: string;  // csv_id of second player
  pair_name: string;    // display_pair_name (optional)
  pair_level: string;   // level of the pair (optional, e.g. A/B/C)
};

export async function importPairsCsvAction(
  tournamentId: string,
  rows: PairCsvRow[]
): Promise<{ ok: true; pairs: number; updated: number; skipped: number } | { error: string }> {
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

  // Existing pairs indexed by pair_code for upsert
  const allTeamIds = [...teamIdSet];
  const { data: existingPairs } = await sb.from("pairs").select("id, pair_code, player_id_1, player_id_2, team_id").in("team_id", allTeamIds);
  const existingByPairCode = new Map(existingPairs?.filter((p) => p.pair_code).map((p) => [p.pair_code!, p.id]) ?? []);
  const existingPlayerPairSet = new Set(existingPairs?.map((p) => `${p.player_id_1}:${p.player_id_2}`) ?? []);

  // Each row = 1 pair
  let pairsCreated = 0, pairsUpdated = 0, skipped = 0;
  for (const r of rows) {
    if (!r.id_player_1 || !r.id_player_2) { skipped++; continue; }
    const p1 = playerByCsvId.get(r.id_player_1);
    const p2 = playerByCsvId.get(r.id_player_2);
    if (!p1 || !p2) { skipped++; continue; }
    if (p1.teamId !== p2.teamId) { skipped++; continue; }

    const payload = {
      player_id_1: p1.id,
      player_id_2: p2.id,
      display_pair_name: r.pair_name || null,
      pair_level: r.pair_level || null,
      pair_code: r.pair_code || null,
    };

    // Upsert by pair_code if provided and exists
    const existingId = r.pair_code ? existingByPairCode.get(r.pair_code) : undefined;
    if (existingId) {
      await sb.from("pairs").update(payload).eq("id", existingId);
      pairsUpdated++;
    } else {
      // Skip if exact player pair already exists (without pair_code)
      const playerKey = `${p1.id}:${p2.id}`;
      const playerKeyRev = `${p2.id}:${p1.id}`;
      if (existingPlayerPairSet.has(playerKey) || existingPlayerPairSet.has(playerKeyRev)) { skipped++; continue; }
      await sb.from("pairs").insert({ team_id: p1.teamId, ...payload });
      pairsCreated++;
    }
  }

  revalidatePath(`/tournaments/${tournamentId}`);
  return { ok: true, pairs: pairsCreated, updated: pairsUpdated, skipped };
}

export async function updateTeamPlayerAction(
  playerId: string,
  fields: { display_name?: string; level?: string | null },
  tournamentId: string
) {
  const session = await getSession();
  if (!session) return await loginRedirect();

  const sb = await createAdminClient();
  const { data: t } = await sb.from("tournaments").select("owner_id").eq("id", tournamentId).single();
  if (!t || t.owner_id !== session.profileId) return { error: "ไม่มีสิทธิ์" };

  if (fields.display_name !== undefined && !fields.display_name.trim()) return { error: "ชื่อห้ามว่าง" };

  const update: Record<string, string | null> = {};
  if (fields.display_name !== undefined) update.display_name = fields.display_name.trim();
  if ("level" in fields) update.level = fields.level ?? null;

  const { error } = await sb
    .from("team_players").update(update).eq("id", playerId);
  if (error) return { error: error.message };

  revalidatePath(`/tournaments/${tournamentId}`);
  return { ok: true };
}

// ============ SHARE TOKEN ============

export async function generateShareTokenAction(tournamentId: string) {
  const session = await getSession();
  if (!session) return await loginRedirect();

  const sb = await createAdminClient();
  const { data: t } = await sb.from("tournaments").select("owner_id").eq("id", tournamentId).single();
  if (!t || t.owner_id !== session.profileId) return { error: "ไม่มีสิทธิ์" };

  const token = crypto.randomUUID();
  const { error } = await sb.from("tournaments").update({ share_token: token }).eq("id", tournamentId);
  if (error) return { error: error.message };

  revalidatePath(`/tournaments/${tournamentId}`);
  return { ok: true, token };
}

export async function revokeShareTokenAction(tournamentId: string) {
  const session = await getSession();
  if (!session) return await loginRedirect();

  const sb = await createAdminClient();
  const { data: t } = await sb.from("tournaments").select("owner_id").eq("id", tournamentId).single();
  if (!t || t.owner_id !== session.profileId) return { error: "ไม่มีสิทธิ์" };

  const { error } = await sb.from("tournaments").update({ share_token: null }).eq("id", tournamentId);
  if (error) return { error: error.message };

  revalidatePath(`/tournaments/${tournamentId}`);
  return { ok: true };
}
