"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/auth/session";
import { assertIsOwner, assertCanEdit } from "@/lib/tournament/permissions";
import { writeAuditLog } from "@/lib/tournament/audit";
import { notifyTournamentEvent } from "@/lib/notification/line";
import {
  TournamentSettingsSchema,
  parseSettings,
  type TournamentSettings,
} from "@/lib/tournament/settings";
import { parseTournamentThresholds } from "@/lib/tournament/divisions";

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

const emptyToNull = z
  .string()
  .optional()
  .transform((s) => (s && s.length > 0 ? s : null));

const TournamentSchema = z.object({
  name: z.string().min(2, "ชื่อทัวร์นาเมนต์สั้นไป"),
  venue: emptyToNull,
  start_date: emptyToNull,
  end_date: emptyToNull,
  format: z.enum(["group_only", "group_knockout", "knockout_only"]),
  mode: z.enum(["sports_day", "competition"]).default("sports_day"),
  match_unit: z.enum(["team", "pair"]).default("team"),
  has_lower_bracket: z.boolean().default(false),
  allow_drop_to_lower: z.boolean().default(false),
  seeding_method: z.enum(["random", "by_group_score"]).default("random"),
  advance_count: z.number().int().min(1).max(8).default(2),
  team_count: z.number().int().min(2).max(64),
  pair_division_thresholds: z
    .array(z.number())
    .default([])
    .transform((arr) =>
      Array.from(new Set(arr.filter((n) => Number.isFinite(n)))).sort((a, b) => a - b)
    ),
  notes: z.string().optional(),
});

export type CreateTournamentInput = z.infer<typeof TournamentSchema>;

export async function createTournamentAction(input: CreateTournamentInput) {
  const session = await getSession();
  if (!session) return await loginRedirect();
  if (session.isGuest) return { error: "ต้องเข้าสู่ระบบด้วย LINE เพื่อสร้างทัวร์นาเมนต์" };

  const parsed = TournamentSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };
  }

  const sb = await createAdminClient();
  const { data, error } = await sb
    .from("tournaments")
    .insert({ ...parsed.data, owner_id: session.profileId })
    .select("id")
    .single();

  if (error || !data) {
    console.error("[createTournamentAction]", error);
    return { error: "สร้างทัวร์นาเมนต์ไม่สำเร็จ" };
  }

  await writeAuditLog({
    tournament_id: data.id,
    actor_id: session.profileId,
    actor_name: session.displayName,
    event_type: "tournament_created",
    entity_type: "tournament",
    entity_id: data.id,
    description: `สร้างทัวร์นาเมนต์: ${parsed.data.name}`,
  });

  revalidatePath("/tournaments");
  redirect(`/tournaments/${data.id}`);
}

// `mode` is intentionally excluded — edits never change mode (one-way upgrade only).
export async function updateTournamentAction(input: Omit<CreateTournamentInput, "mode"> & { id: string }) {
  const session = await getSession();
  if (!session) return await loginRedirect();

  const { id, ...rest } = input;
  const parsed = TournamentSchema.safeParse(rest);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };
  }

  if (!(await assertCanEdit(id, session.profileId))) return { error: "ไม่มีสิทธิ์" };

  const sb = await createAdminClient();

  // Snapshot pre-update fields to compute which fields actually changed
  const { data: before } = await sb
    .from("tournaments")
    .select("name, venue, start_date, end_date, format, match_unit, has_lower_bracket, allow_drop_to_lower, seeding_method, advance_count, team_count, pair_division_thresholds, notes")
    .eq("id", id)
    .maybeSingle();

  // Block threshold change when non-pending matches exist
  const oldThresholds: number[] = parseTournamentThresholds(before?.pair_division_thresholds);
  const newThresholds: number[] = parseTournamentThresholds(parsed.data.pair_division_thresholds);
  if (oldThresholds.join(",") !== newThresholds.join(",")) {
    const { count } = await sb
      .from("matches")
      .select("id", { count: "exact", head: true })
      .eq("tournament_id", id)
      .neq("status", "pending");
    if ((count ?? 0) > 0) {
      return { error: "ห้ามเปลี่ยน threshold หลังเริ่มแมตช์ — รีเซ็ตแมตช์เป็น pending ก่อน" };
    }
  }

  // `mode` is one-way (sports_day → competition via upgradeToCompetitionAction);
  // never let an edit reset it, which would orphan a competition's classes.
  const { mode: _omitMode, ...updateData } = parsed.data;
  const { error } = await sb.from("tournaments").update(updateData).eq("id", id);
  if (error) {
    console.error("[updateTournamentAction]", error);
    return { error: "บันทึกการตั้งค่าไม่สำเร็จ" };
  }

  const changedFields: string[] = [];
  if (before) {
    // Compare only the fields actually written (updateData — `mode` is stripped).
    // `before` doesn't select `mode`, so including it would flag every save.
    for (const key of Object.keys(updateData) as Array<keyof typeof updateData>) {
      const prev = (before as Record<string, unknown>)[key as string];
      const next = (updateData as Record<string, unknown>)[key as string];
      if (prev !== next) changedFields.push(key as string);
    }
  }
  const description = changedFields.length
    ? `อัปเดตการตั้งค่า: ${changedFields.join(", ")}`
    : "อัปเดตการตั้งค่าทัวร์นาเมนต์";

  await writeAuditLog({
    tournament_id: id,
    actor_id: session.profileId,
    actor_name: session.displayName,
    event_type: "tournament_updated",
    entity_type: "tournament",
    entity_id: id,
    description,
  });

  revalidatePath(`/tournaments/${id}`);
  return { ok: true };
}

export async function updateCourtsAction(tournamentId: string, courts: string[]) {
  const session = await getSession();
  if (!session) return await loginRedirect();
  if (!(await assertCanEdit(tournamentId, session.profileId))) return { error: "ไม่มีสิทธิ์" };

  const COURT_NAME_MAX = 40;
  const COURTS_MAX = 50;
  const cleaned = courts
    .map((c) => c.trim().slice(0, COURT_NAME_MAX))
    .filter((c) => c.length > 0);
  const deduped = Array.from(new Set(cleaned)).slice(0, COURTS_MAX);

  const sb = await createAdminClient();
  const { error } = await sb.from("tournaments").update({ courts: deduped }).eq("id", tournamentId);
  if (error) {
    console.error("[updateCourtsAction]", error);
    return { error: "บันทึกสนามไม่สำเร็จ" };
  }

  await writeAuditLog({
    tournament_id: tournamentId,
    actor_id: session.profileId,
    actor_name: session.displayName,
    event_type: "courts_updated",
    entity_type: "tournament",
    entity_id: tournamentId,
    description: `อัปเดตรายการสนาม: ${deduped.length} สนาม`,
  });

  revalidatePath(`/tournaments/${tournamentId}`);
  return { ok: true, courts: deduped };
}

export async function updateTournamentStatusAction(id: string, status: "draft" | "registering" | "ongoing" | "completed") {
  const session = await getSession();
  if (!session) return await loginRedirect();

  if (!(await assertCanEdit(id, session.profileId))) return { error: "ไม่มีสิทธิ์" };

  const sb = await createAdminClient();
  const { error } = await sb.from("tournaments").update({ status }).eq("id", id);
  if (error) {
    console.error("[updateTournamentStatusAction]", error);
    return { error: "บันทึกสถานะไม่สำเร็จ" };
  }

  revalidatePath(`/tournaments/${id}`);
  await writeAuditLog({
    tournament_id: id,
    actor_id: session.profileId,
    actor_name: session.displayName,
    event_type: "status_changed",
    description: `เปลี่ยนสถานะเป็น ${status}`,
  });
  const statusLabel: Record<string, string> = {
    draft: "ร่าง",
    registering: "เปิดรับสมัคร",
    ongoing: "กำลังแข่งขัน",
    completed: "จบการแข่งขัน",
  };
  notifyTournamentEvent(id, "status", `สถานะเปลี่ยนเป็น: ${statusLabel[status] ?? status}`).catch(() => {});
  return { ok: true };
}

export async function updateTournamentSettingsAction(
  tournamentId: string,
  patch: Partial<TournamentSettings>,
) {
  const session = await getSession();
  if (!session) return await loginRedirect();
  if (!(await assertCanEdit(tournamentId, session.profileId))) return { error: "ไม่มีสิทธิ์" };

  const sb = await createAdminClient();
  const { data: row, error: readErr } = await sb
    .from("tournaments")
    .select("settings, share_token")
    .eq("id", tournamentId)
    .maybeSingle();
  if (readErr || !row) return { error: "ไม่พบทัวร์นาเมนต์" };

  const current = parseSettings(row.settings);
  const merged = TournamentSettingsSchema.parse({
    ...current,
    ...patch,
    line_notify: { ...current.line_notify, ...(patch.line_notify ?? {}) },
  });

  const changedKeys: string[] = [];
  for (const key of Object.keys(merged) as Array<keyof TournamentSettings>) {
    if (JSON.stringify(current[key]) !== JSON.stringify(merged[key])) {
      changedKeys.push(key);
    }
  }

  const { error: writeErr } = await sb
    .from("tournaments")
    .update({ settings: merged })
    .eq("id", tournamentId);
  if (writeErr) {
    console.error("[updateTournamentSettingsAction]", writeErr);
    return { error: "บันทึก settings ไม่สำเร็จ" };
  }

  if (changedKeys.length > 0) {
    await writeAuditLog({
      tournament_id: tournamentId,
      actor_id: session.profileId,
      actor_name: session.displayName,
      event_type: "settings_updated",
      entity_type: "tournament",
      entity_id: tournamentId,
      description: `อัปเดต settings: ${changedKeys.join(", ")}`,
    });
  }

  // Use layout-mode revalidate so the entire /t/[token] subtree refreshes —
  // covers /tv, /bracket, /court/[n], and /stats/{...}/[id] (settings affect
  // realtime, line_notify, color_summary, etc. across all of those).
  await revalidateAllTournamentPaths(sb, tournamentId);
  return { ok: true, settings: merged };
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

  if (!(await assertCanEdit(parsed.data.tournament_id, session.profileId))) return { error: "ไม่มีสิทธิ์" };

  const sb = await createAdminClient();
  const { error } = await sb.from("teams").insert(parsed.data);
  if (error) {
    console.error("[createTeamAction]", error);
    return { error: "เพิ่มทีมไม่สำเร็จ" };
  }

  revalidatePath(`/tournaments/${parsed.data.tournament_id}`);
  await writeAuditLog({
    tournament_id: parsed.data.tournament_id,
    actor_id: session.profileId,
    actor_name: session.displayName,
    event_type: "team_created",
    entity_type: "team",
    description: `เพิ่มทีม: ${parsed.data.name}`,
  });
  return { ok: true };
}

export async function deleteTeamAction(teamId: string, tournamentId: string) {
  const session = await getSession();
  if (!session) return await loginRedirect();

  if (!(await assertCanEdit(tournamentId, session.profileId))) return { error: "ไม่มีสิทธิ์" };

  const sb = await createAdminClient();
  const { error: deleteError } = await sb.from("teams").delete().eq("id", teamId);
  if (deleteError) return { error: "ลบทีมไม่สำเร็จ" };
  revalidatePath(`/tournaments/${tournamentId}`);
  await writeAuditLog({
    tournament_id: tournamentId,
    actor_id: session.profileId,
    actor_name: session.displayName,
    event_type: "team_deleted",
    entity_type: "team",
    entity_id: teamId,
    description: `ลบทีม`,
  });
  return { ok: true };
}

export async function addTeamPlayerAction(input: { team_id: string; display_name: string; role: "captain" | "member"; level?: string; tournament_id: string }) {
  const session = await getSession();
  if (!session) return await loginRedirect();

  if (!(await assertCanEdit(input.tournament_id, session.profileId))) return { error: "ไม่มีสิทธิ์" };

  const sb = await createAdminClient();
  const { error } = await sb.from("team_players").insert({
    team_id: input.team_id,
    display_name: input.display_name,
    role: input.role,
    level: input.level || null,
    profile_id: session.profileId,
  });
  if (error) {
    console.error("[addTeamPlayerAction]", error);
    return { error: "เพิ่มผู้เล่นไม่สำเร็จ" };
  }

  revalidatePath(`/tournaments/${input.tournament_id}`);
  await writeAuditLog({
    tournament_id: input.tournament_id,
    actor_id: session.profileId,
    actor_name: session.displayName,
    event_type: "player_added",
    entity_type: "player",
    description: `เพิ่มผู้เล่น: ${input.display_name}`,
  });
  return { ok: true };
}

export async function removeTeamPlayerAction(playerId: string, tournamentId: string) {
  const session = await getSession();
  if (!session) return await loginRedirect();

  if (!(await assertCanEdit(tournamentId, session.profileId))) return { error: "ไม่มีสิทธิ์" };

  const sb = await createAdminClient();
  const { error: deleteError } = await sb.from("team_players").delete().eq("id", playerId);
  if (deleteError) return { error: "ลบผู้เล่นไม่สำเร็จ" };
  revalidatePath(`/tournaments/${tournamentId}`);
  await writeAuditLog({
    tournament_id: tournamentId,
    actor_id: session.profileId,
    actor_name: session.displayName,
    event_type: "player_removed",
    entity_type: "player",
    entity_id: playerId,
    description: `ลบผู้เล่น`,
  });
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

  if (!(await assertCanEdit(tournamentId, session.profileId))) return { error: "ไม่มีสิทธิ์" };
  if (!rows.length) return { error: "ไฟล์ไม่มีข้อมูล" };

  const sb = await createAdminClient();
  const prevTeamCount = (await sb.from("teams").select("id", { count: "exact", head: true }).eq("tournament_id", tournamentId)).count ?? 0;
  const teamByName = await ensureTeams(sb, tournamentId, rows);
  const teamsCreated = teamByName.size - prevTeamCount;

  const allTeamIds = [...teamByName.values()];
  const { data: existingPlayers } = await sb
    .from("team_players").select("id, team_id, csv_id").in("team_id", allTeamIds);
  const existingByCsvId = new Map(
    existingPlayers?.filter((p) => p.csv_id).map((p) => [`${p.team_id}:${p.csv_id}`, p.id]) ?? []
  );

  // Dedupe rows by (team_id, csv_id) within this CSV batch — last write wins.
  // Without this, Promise.all races duplicates against the pre-fetched existingByCsvId map.
  const dedupedRows = new Map<string, PlayerCsvRow & { __teamId: string }>();
  for (const r of rows) {
    const teamId = teamByName.get(r.team);
    if (!teamId) continue;
    dedupedRows.set(`${teamId}:${r.csv_id}`, { ...r, __teamId: teamId });
  }

  let created = 0, updated = 0;
  await Promise.all(
    [...dedupedRows.values()].map(async (r) => {
      const teamId = r.__teamId;
      const existingId = existingByCsvId.get(`${teamId}:${r.csv_id}`);
      if (existingId) {
        await sb.from("team_players").update({ display_name: r.display_name, role: r.role, level: r.level || null }).eq("id", existingId);
        updated++;
      } else {
        await sb.from("team_players").insert({ team_id: teamId, csv_id: r.csv_id, display_name: r.display_name, role: r.role, level: r.level || null });
        created++;
      }
    })
  );

  revalidatePath(`/tournaments/${tournamentId}`);
  await writeAuditLog({
    tournament_id: tournamentId,
    actor_id: session.profileId,
    actor_name: session.displayName,
    event_type: "csv_imported",
    entity_type: "tournament",
    entity_id: tournamentId,
    description: `นำเข้าผู้เล่น ${created + updated} คน`,
  });
  return { ok: true, teams: teamsCreated, created, updated };
}

// ── Step 2: Import pairs ──────────────────────────────────────────────────────

export type PairCsvRow = {
  team: string;         // team name (informational)
  pair_id: string;      // pair UUID for upsert (empty = new pair)
  id_player_1: string;  // csv_id of first player
  id_player_2: string;  // csv_id of second player
  pair_name: string;    // display_pair_name (optional)
  class_code: string;   // tournament_classes.code — required when tournament has classes (competition mode); tolerated empty for sports_day
};

export async function importPairsCsvAction(
  tournamentId: string,
  rows: PairCsvRow[]
): Promise<{ ok: true; pairs: number; updated: number; skipped: number; unknownClassCodes: string[] } | { error: string }> {
  const session = await getSession();
  if (!session) return await loginRedirect();

  if (!(await assertCanEdit(tournamentId, session.profileId))) return { error: "ไม่มีสิทธิ์" };
  if (!rows.length) return { error: "ไฟล์ไม่มีข้อมูล" };

  const sb = await createAdminClient();

  // Build csv_id → {player_id, team_id, level} map for this tournament
  const { data: players } = await sb
    .from("team_players")
    .select("id, team_id, csv_id, level")
    .not("csv_id", "is", null);

  const { data: teams } = await sb.from("teams").select("id").eq("tournament_id", tournamentId);
  const teamIdSet = new Set(teams?.map((t) => t.id) ?? []);

  // Competition mode REQUIRES a valid class_code per row (gate on mode, not on
  // class existence — a competition tournament with zero classes must reject the
  // import rather than silently inserting pairs with class_id = null).
  const { data: tourn } = await sb
    .from("tournaments").select("mode").eq("id", tournamentId).maybeSingle();
  const requireClass = tourn?.mode === "competition";
  const { data: classRows } = await sb
    .from("tournament_classes").select("id, code").eq("tournament_id", tournamentId);
  const classByCode = new Map<string, string>((classRows ?? []).map((c) => [c.code, c.id]));
  if (requireClass && classByCode.size === 0) {
    return { error: "ยังไม่มี class — สร้าง class ในแท็บตั้งค่าก่อนนำเข้าคู่" };
  }
  const unknownClassCodes = new Set<string>();

  const playerByCsvId = new Map<string, { id: string; teamId: string; level: string | null }>();
  for (const p of players ?? []) {
    if (p.csv_id && teamIdSet.has(p.team_id)) {
      playerByCsvId.set(p.csv_id, { id: p.id, teamId: p.team_id, level: p.level as string | null });
    }
  }

  // Existing pairs indexed by id for upsert
  const allTeamIds = [...teamIdSet];
  const { data: existingPairs } = await sb.from("pairs").select("id, player_id_1, player_id_2, team_id").in("team_id", allTeamIds);
  const existingIdSet = new Set(existingPairs?.map((p) => p.id) ?? []);
  const existingPlayerPairSet = new Set(existingPairs?.map((p) => `${p.player_id_1}:${p.player_id_2}`) ?? []);

  // Dedupe rows within this CSV batch — last write wins.
  // Key: pair_id if provided (upsert key), else canonical sorted (id_player_1, id_player_2).
  // Without this, duplicates in the same upload all insert as new pairs.
  const dedupedRows = new Map<string, PairCsvRow>();
  for (const r of rows) {
    let key: string;
    if (r.pair_id) {
      key = `id:${r.pair_id}`;
    } else if (r.id_player_1 && r.id_player_2) {
      const sorted = [r.id_player_1, r.id_player_2].sort();
      key = `pp:${sorted[0]}:${sorted[1]}`;
    } else {
      // Will be skipped by the loop anyway; preserve so the skipped counter still ticks
      key = `bad:${dedupedRows.size}`;
    }
    dedupedRows.set(key, r);
  }

  // Each row = 1 pair
  let pairsCreated = 0, pairsUpdated = 0, skipped = 0;
  for (const r of dedupedRows.values()) {
    if (!r.id_player_1 || !r.id_player_2) { skipped++; continue; }
    const p1 = playerByCsvId.get(r.id_player_1);
    const p2 = playerByCsvId.get(r.id_player_2);
    if (!p1 || !p2) { skipped++; continue; }
    if (p1.teamId !== p2.teamId) { skipped++; continue; }

    // Resolve class (competition mode requires a valid class per row).
    let classId: string | null = null;
    if (requireClass) {
      const code = r.class_code?.trim();
      // Empty code is reported too (not just unknown) so the importer surfaces a
      // clear error instead of a silent "ข้าม N".
      if (!code) { skipped++; unknownClassCodes.add("(ไม่ระบุ)"); continue; }
      const cid = classByCode.get(code);
      if (!cid) { skipped++; unknownClassCodes.add(code); continue; }
      classId = cid;
    }

    const pairLevel = (() => {
      const n1 = parseFloat(p1.level ?? "");
      const n2 = parseFloat(p2.level ?? "");
      if (isNaN(n1) && isNaN(n2)) return null;
      return String((isNaN(n1) ? 0 : n1) + (isNaN(n2) ? 0 : n2));
    })();
    const payload = {
      player_id_1: p1.id,
      player_id_2: p2.id,
      display_pair_name: r.pair_name || null,
      pair_level: pairLevel,
      class_id: classId,
    };

    // Upsert by pair_id if provided and exists in DB
    if (r.pair_id && existingIdSet.has(r.pair_id)) {
      await sb.from("pairs").update(payload).eq("id", r.pair_id);
      pairsUpdated++;
    } else {
      // Skip if exact player pair already exists
      const playerKey = `${p1.id}:${p2.id}`;
      const playerKeyRev = `${p2.id}:${p1.id}`;
      if (existingPlayerPairSet.has(playerKey) || existingPlayerPairSet.has(playerKeyRev)) { skipped++; continue; }
      await sb.from("pairs").insert({ team_id: p1.teamId, ...payload });
      pairsCreated++;
    }
  }

  revalidatePath(`/tournaments/${tournamentId}`);
  await writeAuditLog({
    tournament_id: tournamentId,
    actor_id: session.profileId,
    actor_name: session.displayName,
    event_type: "csv_imported",
    entity_type: "tournament",
    entity_id: tournamentId,
    description: `นำเข้าคู่ ${pairsCreated + pairsUpdated} คู่`,
  });
  return { ok: true, pairs: pairsCreated, updated: pairsUpdated, skipped, unknownClassCodes: [...unknownClassCodes] };
}

export async function updateTeamPlayerAction(
  playerId: string,
  fields: { display_name?: string; level?: string | null },
  tournamentId: string
) {
  const session = await getSession();
  if (!session) return await loginRedirect();

  if (!(await assertCanEdit(tournamentId, session.profileId))) return { error: "ไม่มีสิทธิ์" };

  if (fields.display_name !== undefined && !fields.display_name.trim()) return { error: "กรุณาระบุชื่อ" };

  const update: Record<string, string | null> = {};
  if (fields.display_name !== undefined) update.display_name = fields.display_name.trim();
  if ("level" in fields) update.level = fields.level ?? null;

  const sb = await createAdminClient();
  const { error } = await sb
    .from("team_players").update(update).eq("id", playerId);
  if (error) {
    console.error("[updateTeamPlayerAction]", error);
    return { error: "บันทึกข้อมูลผู้เล่นไม่สำเร็จ" };
  }

  revalidatePath(`/tournaments/${tournamentId}`);
  await writeAuditLog({
    tournament_id: tournamentId,
    actor_id: session.profileId,
    actor_name: session.displayName,
    event_type: "player_edited",
    entity_type: "player",
    entity_id: playerId,
    description: `แก้ไขผู้เล่น`,
  });
  return { ok: true };
}

// ============ SHARE TOKEN ============

export async function generateShareTokenAction(tournamentId: string) {
  const session = await getSession();
  if (!session) return await loginRedirect();

  if (!(await assertIsOwner(tournamentId, session.profileId))) return { error: "ไม่มีสิทธิ์" };

  const sb = await createAdminClient();
  const token = crypto.randomUUID();
  const { error } = await sb.from("tournaments").update({ share_token: token }).eq("id", tournamentId);
  if (error) {
    console.error("[generateShareTokenAction]", error);
    return { error: "สร้างลิงก์ไม่สำเร็จ" };
  }

  await writeAuditLog({
    tournament_id: tournamentId,
    actor_id: session.profileId,
    actor_name: session.displayName,
    event_type: "share_token_generated",
    entity_type: "tournament",
    entity_id: tournamentId,
    description: "สร้างลิงก์แชร์สาธารณะ",
  });

  revalidatePath(`/tournaments/${tournamentId}`);
  return { ok: true, token };
}

export async function revokeShareTokenAction(tournamentId: string) {
  const session = await getSession();
  if (!session) return await loginRedirect();

  if (!(await assertIsOwner(tournamentId, session.profileId))) return { error: "ไม่มีสิทธิ์" };

  const sb = await createAdminClient();
  const { error } = await sb.from("tournaments").update({ share_token: null }).eq("id", tournamentId);
  if (error) {
    console.error("[revokeShareTokenAction]", error);
    return { error: "ยกเลิกลิงก์ไม่สำเร็จ" };
  }

  await writeAuditLog({
    tournament_id: tournamentId,
    actor_id: session.profileId,
    actor_name: session.displayName,
    event_type: "share_token_revoked",
    entity_type: "tournament",
    entity_id: tournamentId,
    description: "ยกเลิกลิงก์แชร์สาธารณะ",
  });

  revalidatePath(`/tournaments/${tournamentId}`);
  return { ok: true };
}

// ============ CHECK-IN (Phase 12) ============

async function revalidateAllTournamentPaths(
  sb: Awaited<ReturnType<typeof createAdminClient>>,
  tournamentId: string
) {
  revalidatePath(`/tournaments/${tournamentId}`);
  const { data, error } = await sb.from("tournaments").select("share_token").eq("id", tournamentId).maybeSingle();
  if (error) {
    console.error("revalidateAllTournamentPaths share_token lookup:", error);
    return;
  }
  if (data?.share_token) {
    // 'layout' invalidates the entire /t/[token] subtree — covers /tv,
    // /bracket, /court/[n], and /stats/{pair|player|team|division}/[id].
    revalidatePath(`/t/${data.share_token}`, "layout");
  }
}

export async function toggleTeamPlayerCheckInAction(input: { playerId: string; tournamentId: string }) {
  const session = await getSession();
  if (!session) return await loginRedirect();
  if (!(await assertCanEdit(input.tournamentId, session.profileId))) return { error: "ไม่มีสิทธิ์" };

  const sb = await createAdminClient();
  const { data: player } = await sb
    .from("team_players")
    .select("id, display_name, checked_in_at, team:teams!inner(tournament_id)")
    .eq("id", input.playerId)
    .maybeSingle();
  if (!player) return { error: "ไม่พบผู้เล่น" };
  const team = Array.isArray(player.team) ? player.team[0] : player.team;
  if (!team || team.tournament_id !== input.tournamentId) return { error: "ผู้เล่นไม่อยู่ในทัวร์นี้" };

  const next = player.checked_in_at ? null : new Date().toISOString();
  const { error } = await sb.from("team_players").update({ checked_in_at: next }).eq("id", input.playerId);
  if (error) {
    console.error("[toggleTeamPlayerCheckInAction]", error);
    return { error: "บันทึกสถานะเช็คอินไม่สำเร็จ" };
  }

  await writeAuditLog({
    tournament_id: input.tournamentId,
    actor_id: session.profileId,
    actor_name: session.displayName,
    event_type: next ? "player_checked_in" : "player_checked_out",
    entity_type: "team_player",
    entity_id: input.playerId,
    description: `${next ? "เช็คอิน" : "ยกเลิกเช็คอิน"}: ${player.display_name}`,
  });

  await revalidateAllTournamentPaths(sb, input.tournamentId);
  return { ok: true };
}

export async function bulkCheckInTeamAction(input: { teamId: string; tournamentId: string; checkIn: boolean }) {
  const session = await getSession();
  if (!session) return await loginRedirect();
  if (!(await assertCanEdit(input.tournamentId, session.profileId))) return { error: "ไม่มีสิทธิ์" };

  const sb = await createAdminClient();
  const { data: team } = await sb
    .from("teams")
    .select("id, name, tournament_id")
    .eq("id", input.teamId)
    .maybeSingle();
  if (!team || team.tournament_id !== input.tournamentId) return { error: "ไม่พบทีม" };

  const next = input.checkIn ? new Date().toISOString() : null;
  // Idempotent: only touch rows whose current state differs. Preserves existing
  // arrival timestamps (V5) and makes the action safe under cross-device races (S7).
  let q = sb
    .from("team_players")
    .update({ checked_in_at: next })
    .eq("team_id", input.teamId);
  q = input.checkIn ? q.is("checked_in_at", null) : q.not("checked_in_at", "is", null);
  const { data: updated, error } = await q.select("id");
  if (error) {
    console.error("[bulkCheckInTeamAction]", error);
    return { error: "บันทึกสถานะเช็คอินไม่สำเร็จ" };
  }
  const count = updated?.length ?? 0;
  if (count === 0) {
    // Still revalidate so any client looking at a stale snapshot
    // (cross-device race) gets a fresh render after dispatch.
    await revalidateAllTournamentPaths(sb, input.tournamentId);
    return { ok: true, count: 0, noop: true };
  }

  await writeAuditLog({
    tournament_id: input.tournamentId,
    actor_id: session.profileId,
    actor_name: session.displayName,
    event_type: input.checkIn ? "team_bulk_checked_in" : "team_bulk_checked_out",
    entity_type: "team",
    entity_id: input.teamId,
    description: `${input.checkIn ? "เช็คอิน" : "ยกเลิกเช็คอิน"}ทีม ${team.name} ${input.checkIn ? "+" : "-"}${count} คน`,
  });

  await revalidateAllTournamentPaths(sb, input.tournamentId);
  return { ok: true, count };
}

export async function resetAllCheckInsAction(tournamentId: string) {
  const session = await getSession();
  if (!session) return await loginRedirect();
  if (!(await assertCanEdit(tournamentId, session.profileId))) return { error: "ไม่มีสิทธิ์" };

  const sb = await createAdminClient();
  const { data: teams, error: teamsErr } = await sb
    .from("teams")
    .select("id")
    .eq("tournament_id", tournamentId);
  if (teamsErr) {
    console.error("[resetAllCheckInsAction] teams lookup:", teamsErr);
    return { error: "โหลดทีมไม่สำเร็จ" };
  }
  const teamIds = (teams ?? []).map((t) => t.id);
  if (teamIds.length === 0) return { ok: true, count: 0, noop: true };

  const { data: updated, error } = await sb
    .from("team_players")
    .update({ checked_in_at: null })
    .in("team_id", teamIds)
    .not("checked_in_at", "is", null)
    .select("id");
  if (error) {
    console.error("[resetAllCheckInsAction]", error);
    return { error: "รีเซ็ตเช็คอินไม่สำเร็จ" };
  }
  const count = updated?.length ?? 0;
  if (count === 0) {
    // Nobody was checked in — skip audit + revalidate noise. Signal noop so
    // the client surfaces toast.info instead of toast.success "0 คน".
    return { ok: true, count: 0, noop: true };
  }

  await writeAuditLog({
    tournament_id: tournamentId,
    actor_id: session.profileId,
    actor_name: session.displayName,
    event_type: "tournament_checkins_reset",
    entity_type: "tournament",
    entity_id: tournamentId,
    description: `รีเซ็ตเช็คอินทั้งหมด (${count} คน)`,
  });

  await revalidateAllTournamentPaths(sb, tournamentId);
  return { ok: true, count };
}
