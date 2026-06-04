"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/auth/session";
import { assertIsOwner, assertCanEdit } from "@/lib/tournament/permissions";
import { writeAuditLog } from "@/lib/tournament/audit";
import { generateAllPairMatches } from "@/lib/tournament/scheduling";
import { computeStandings } from "@/lib/tournament/scoring";
import { buildBracket, buildDoubleBracket, nextPowerOf2 } from "@/lib/tournament/bracket";
import type { BracketEntry, BracketMatchDef } from "@/lib/tournament/bracket";
import type { Match, TournamentFormat } from "@/lib/types";
import { balancedTeamGroupAssignment } from "@/lib/tournament/class-grouping";

// ============ ASSUMPTIONS ============
// 1. Group membership (which pairs are in which group) is NOT stored in a junction
//    table — it is implicit in `matches.group_id`. generateGroupsForClassAction
//    re-runs the deterministic balancedTeamGroupAssignment and zips by position
//    against the existing group rows (delete old groups first, insert fresh ones).
// 2. `division` is set to null on all class matches — classes replace divisions;
//    applyDivisionPriorityOrdering is NOT called (it is tournament-wide + division-based).
// 3. match_number continues from the tournament-global max (across all classes and
//    round_types) to avoid collisions in the shared matches table.
// 4. revalidateTournamentPaths is private in matches.ts — replicated here (~15 lines).
// 5. replace_tournament_matches / regenerate_tournament_groups RPCs are NOT used
//    because they operate tournament-wide and would delete sibling classes' data.
//    All DML is scoped by class_id.

// ============ TYPES ============

export type ClassInput = {
  code: string;
  name: string;
  pair_capacity?: number | null;
  pairs_per_group: number;
  format: TournamentFormat;
  advance_count: number;
  has_lower_bracket: boolean;
  allow_drop_to_lower: boolean;
  match_format: "fixed_2" | "best_of_3" | "best_of_5";
};

// ============ INTERNALS ============

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

// Replicated from matches.ts (private there) — same logic.
async function revalidateTournamentPaths(
  sb: Awaited<ReturnType<typeof createAdminClient>>,
  tournamentId: string,
): Promise<void> {
  revalidatePath(`/tournaments/${tournamentId}`);
  const { data, error } = await sb
    .from("tournaments")
    .select("share_token")
    .eq("id", tournamentId)
    .maybeSingle();
  if (error) {
    console.error("[classes] revalidateTournamentPaths share_token lookup:", error);
    return;
  }
  if (data?.share_token) {
    revalidatePath(`/t/${data.share_token}`, "layout");
  }
}

/**
 * Returns the tournament-global next match_number (max across ALL round_types).
 * Must continue from the overall max so class matches don't collide with
 * each other or with existing sports_day matches in the same tournament.
 */
async function getNextGlobalMatchNumber(
  sb: Awaited<ReturnType<typeof createAdminClient>>,
  tournamentId: string,
): Promise<number> {
  const { data } = await sb
    .from("matches")
    .select("match_number")
    .eq("tournament_id", tournamentId)
    .order("match_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data?.match_number ?? 0) + 1;
}

/** Resolve the tournament_id for a class row (used in permission checks). */
async function getClassTournamentId(
  sb: Awaited<ReturnType<typeof createAdminClient>>,
  classId: string,
): Promise<string | null> {
  const { data } = await sb
    .from("tournament_classes")
    .select("tournament_id")
    .eq("id", classId)
    .maybeSingle();
  return data?.tournament_id ?? null;
}

// BYE walkover score convention — mirrors matches.ts exactly.
function byeWalkoverGames(winnerIs: "a" | "b"): {
  games: { a: number; b: number }[];
  teamAScore: number;
  teamBScore: number;
} {
  return winnerIs === "a"
    ? { games: [{ a: 21, b: 15 }, { a: 21, b: 15 }], teamAScore: 2, teamBScore: 0 }
    : { games: [{ a: 15, b: 21 }, { a: 15, b: 21 }], teamAScore: 0, teamBScore: 2 };
}

// ============ CRUD (owner-only) ============

export async function createClassAction(
  tournamentId: string,
  input: ClassInput,
): Promise<{ ok: true; classId: string } | { error: string }> {
  const session = await getSession();
  if (!session) return await loginRedirect();
  if (!(await assertIsOwner(tournamentId, session.profileId))) return { error: "ไม่มีสิทธิ์" };

  const sb = await createAdminClient();

  // Compute next position = current max + 1 for this tournament.
  const { data: maxRow } = await sb
    .from("tournament_classes")
    .select("position")
    .eq("tournament_id", tournamentId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  const position = (maxRow?.position ?? -1) + 1;

  const { data, error } = await sb
    .from("tournament_classes")
    .insert({
      tournament_id: tournamentId,
      code: input.code.trim(),
      name: input.name.trim(),
      pair_capacity: input.pair_capacity ?? null,
      pairs_per_group: input.pairs_per_group,
      format: input.format,
      advance_count: input.advance_count,
      has_lower_bracket: input.has_lower_bracket,
      allow_drop_to_lower: input.allow_drop_to_lower,
      match_format: input.match_format,
      position,
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") return { error: `รหัส class "${input.code}" ซ้ำใน tournament นี้` };
    console.error("[createClassAction]", error);
    return { error: "สร้าง class ไม่สำเร็จ" };
  }

  await writeAuditLog({
    tournament_id: tournamentId,
    actor_id: session.profileId,
    actor_name: session.displayName,
    event_type: "class_created",
    entity_type: "class",
    entity_id: data.id,
    description: `สร้าง class "${input.code}" — ${input.name}`,
  });

  revalidatePath(`/tournaments/${tournamentId}`);
  return { ok: true, classId: data.id };
}

export async function updateClassAction(
  classId: string,
  patch: Partial<ClassInput>,
): Promise<{ ok: true } | { error: string }> {
  const session = await getSession();
  if (!session) return await loginRedirect();

  const sb = await createAdminClient();

  const tournamentId = await getClassTournamentId(sb, classId);
  if (!tournamentId) return { error: "ไม่พบ class" };

  if (!(await assertIsOwner(tournamentId, session.profileId))) return { error: "ไม่มีสิทธิ์" };

  // Only include fields present in the patch to avoid overwriting with undefined.
  const update: Record<string, unknown> = {};
  if (patch.code !== undefined) update.code = patch.code.trim();
  if (patch.name !== undefined) update.name = patch.name.trim();
  if ("pair_capacity" in patch) update.pair_capacity = patch.pair_capacity ?? null;
  if (patch.pairs_per_group !== undefined) update.pairs_per_group = patch.pairs_per_group;
  if (patch.format !== undefined) update.format = patch.format;
  if (patch.advance_count !== undefined) update.advance_count = patch.advance_count;
  if (patch.has_lower_bracket !== undefined) update.has_lower_bracket = patch.has_lower_bracket;
  if (patch.allow_drop_to_lower !== undefined) update.allow_drop_to_lower = patch.allow_drop_to_lower;
  if (patch.match_format !== undefined) update.match_format = patch.match_format;

  if (Object.keys(update).length === 0) return { ok: true };

  const { error } = await sb
    .from("tournament_classes")
    .update(update)
    .eq("id", classId);

  if (error) {
    if (error.code === "23505") return { error: "รหัส class ซ้ำ — ใช้รหัสอื่น" };
    console.error("[updateClassAction]", error);
    return { error: "อัปเดต class ไม่สำเร็จ" };
  }

  const changedKeys = Object.keys(update).join(", ");
  await writeAuditLog({
    tournament_id: tournamentId,
    actor_id: session.profileId,
    actor_name: session.displayName,
    event_type: "class_updated",
    entity_type: "class",
    entity_id: classId,
    description: `อัปเดต class: ${changedKeys}`,
  });

  revalidatePath(`/tournaments/${tournamentId}`);
  return { ok: true };
}

export async function deleteClassAction(
  classId: string,
): Promise<{ ok: true } | { error: string }> {
  const session = await getSession();
  if (!session) return await loginRedirect();

  const sb = await createAdminClient();

  const { data: classRow } = await sb
    .from("tournament_classes")
    .select("id, tournament_id, code, name")
    .eq("id", classId)
    .maybeSingle();
  if (!classRow) return { error: "ไม่พบ class" };

  const { tournament_id: tournamentId } = classRow;
  if (!(await assertIsOwner(tournamentId, session.profileId))) return { error: "ไม่มีสิทธิ์" };

  // Guard: refuse if any completed match exists for this class.
  const { count: completedCount, error: countErr } = await sb
    .from("matches")
    .select("id", { count: "exact", head: true })
    .eq("class_id", classId)
    .eq("status", "completed");

  if (countErr) {
    console.error("[deleteClassAction] count check:", countErr);
    return { error: "ตรวจสอบแมตช์ไม่สำเร็จ" };
  }

  if ((completedCount ?? 0) > 0) {
    return { error: "ลบไม่ได้ — มีแมตช์ที่จบแล้วใน class นี้" };
  }

  // FK CASCADE on groups + matches; SET NULL on pairs — all handled by DB.
  const { error: deleteErr } = await sb
    .from("tournament_classes")
    .delete()
    .eq("id", classId);

  if (deleteErr) {
    console.error("[deleteClassAction]", deleteErr);
    return { error: "ลบ class ไม่สำเร็จ" };
  }

  await writeAuditLog({
    tournament_id: tournamentId,
    actor_id: session.profileId,
    actor_name: session.displayName,
    event_type: "class_deleted",
    entity_type: "class",
    entity_id: classId,
    description: `ลบ class "${classRow.code}" — ${classRow.name}`,
  });

  revalidatePath(`/tournaments/${tournamentId}`);
  return { ok: true };
}

export async function reorderClassesAction(
  tournamentId: string,
  orderedIds: string[],
): Promise<{ ok: true } | { error: string }> {
  const session = await getSession();
  if (!session) return await loginRedirect();
  if (!(await assertIsOwner(tournamentId, session.profileId))) return { error: "ไม่มีสิทธิ์" };
  if (orderedIds.length === 0) return { ok: true };

  const sb = await createAdminClient();

  // Bulk-update position. No unique constraint on (tournament_id, position) so
  // we can write in a single pass without a two-phase offset technique.
  const updates = orderedIds.map((id, idx) =>
    sb
      .from("tournament_classes")
      .update({ position: idx })
      .eq("id", id)
      .eq("tournament_id", tournamentId),
  );

  const results = await Promise.all(updates);
  for (const { error } of results) {
    if (error) {
      console.error("[reorderClassesAction]", error);
      return { error: "บันทึกลำดับ class ไม่สำเร็จ" };
    }
  }

  await writeAuditLog({
    tournament_id: tournamentId,
    actor_id: session.profileId,
    actor_name: session.displayName,
    event_type: "classes_reordered",
    entity_type: "tournament",
    entity_id: tournamentId,
    description: `จัดลำดับ class ${orderedIds.length} รายการ`,
  });

  revalidatePath(`/tournaments/${tournamentId}`);
  return { ok: true };
}

// ============ GENERATE — GROUP STAGE (owner OR co-admin) ============

/**
 * Generate groups + round-robin group matches for one class.
 *
 * Flow:
 *  1. Load class config + pairs assigned to this class.
 *  2. Run balancedTeamGroupAssignment (cross-team rule, deterministic).
 *  3. Delete this class's existing groups + matches (scoped — siblings untouched).
 *  4. Insert fresh groups rows with class_id + tournament_id.
 *  5. Build round-robin within each group via generateAllPairMatches
 *     (each pair is its own singleton "team" to honour the cross-team guarantee).
 *  6. Insert match rows with class_id + group_id; match_number continues from
 *     tournament-global max to avoid collisions.
 *  7. Audit + revalidate.
 */
export async function generateGroupsForClassAction(
  classId: string,
): Promise<{ ok: true; groupCount: number; matchCount: number } | { error: string }> {
  const session = await getSession();
  if (!session) return await loginRedirect();

  const sb = await createAdminClient();

  const { data: classRow } = await sb
    .from("tournament_classes")
    .select("id, tournament_id, code, name, pairs_per_group, format")
    .eq("id", classId)
    .maybeSingle();
  if (!classRow) return { error: "ไม่พบ class" };

  const { tournament_id: tournamentId } = classRow;
  if (!(await assertCanEdit(tournamentId, session.profileId))) return { error: "ไม่มีสิทธิ์" };

  if (classRow.format === "knockout_only") {
    return { error: "class นี้ใช้รูปแบบ knockout_only — ไม่มีรอบกลุ่ม" };
  }

  // Load pairs assigned to this class.
  type RawPair = { id: string; team_id: string };
  const { data: pairsRaw } = await sb
    .from("pairs")
    .select("id, team_id")
    .eq("class_id", classId);

  const pairs = (pairsRaw ?? []) as RawPair[];
  if (pairs.length < 2) return { error: "ต้องมีคู่อย่างน้อย 2 คู่ใน class นี้" };

  // Run the balanced grouping algorithm.
  const groupingResult = balancedTeamGroupAssignment(
    pairs.map((p) => ({ pairId: p.id, teamId: p.team_id })),
    classRow.pairs_per_group,
  );
  if (!groupingResult.ok) return { error: groupingResult.error };

  const { groups: groupPairArrays } = groupingResult;
  if (groupPairArrays.length === 0) return { error: "ไม่สามารถจัดกลุ่มได้ — ตรวจสอบจำนวนคู่" };

  // Scoped delete: remove existing groups + their matches for this class only.
  // matches.class_id CASCADE handles match deletion when the group is deleted,
  // but we also delete class-level matches that may lack a group_id (none expected
  // in this flow, but defensive cleanup).
  const { data: existingGroups } = await sb
    .from("groups")
    .select("id")
    .eq("class_id", classId)
    .eq("tournament_id", tournamentId);

  if (existingGroups && existingGroups.length > 0) {
    // Delete all matches for this class first (covers group + any stray rows).
    await sb.from("matches").delete().eq("class_id", classId).eq("tournament_id", tournamentId);
    // Then delete the group rows themselves.
    await sb.from("groups").delete().eq("class_id", classId).eq("tournament_id", tournamentId);
  }

  // Insert fresh group rows.
  const groupInserts = groupPairArrays.map((_, idx) => ({
    tournament_id: tournamentId,
    class_id: classId,
    name: `กลุ่ม ${String.fromCharCode(65 + idx)}`, // A, B, C, ...
  }));

  const { data: insertedGroups, error: groupInsertErr } = await sb
    .from("groups")
    .insert(groupInserts)
    .select("id");

  if (groupInsertErr || !insertedGroups) {
    console.error("[generateGroupsForClassAction] group insert:", groupInsertErr);
    return { error: "สร้างกลุ่มไม่สำเร็จ" };
  }

  // insertedGroups order matches groupInserts order (same-batch insert preserves order).
  // Build a lookup: pairId → teamId for round-robin construction.
  const pairTeamMap = new Map(pairs.map((p) => [p.id, p.team_id]));

  // Reserve match_number range from tournament-global max.
  let nextMatchNum = await getNextGlobalMatchNumber(sb, tournamentId);

  const matchInserts: Record<string, unknown>[] = [];

  for (let gi = 0; gi < groupPairArrays.length; gi++) {
    const groupId = insertedGroups[gi].id;
    const groupPairIds = groupPairArrays[gi];

    // Map each pair as a singleton "team" — generateAllPairMatches produces
    // every i<j pair which is exactly round-robin within the group.
    const singletonTeams = groupPairIds.map((pairId) => ({
      teamId: pairTeamMap.get(pairId) ?? pairId, // fallback: use pairId itself (should not happen)
      pairIds: [pairId],
    }));

    const rrMatches = generateAllPairMatches(singletonTeams);

    for (const m of rrMatches) {
      matchInserts.push({
        tournament_id: tournamentId,
        class_id: classId,
        group_id: groupId,
        round_type: "group",
        round_number: 1,
        match_number: nextMatchNum++,
        pair_a_id: m.pairAId,
        pair_b_id: m.pairBId,
        // team_a_id / team_b_id intentionally omitted — pair mode (null)
        division: null, // classes replace divisions; see ASSUMPTIONS
        status: "pending",
        games: [],
      });
    }
  }

  if (matchInserts.length === 0) {
    // Clean up the groups we just created — no matches to play.
    await sb.from("groups").delete().eq("class_id", classId).eq("tournament_id", tournamentId);
    return { error: "ไม่สามารถสร้างแมตช์ได้ — ตรวจสอบจำนวนคู่ในกลุ่ม" };
  }

  const { error: matchInsertErr } = await sb.from("matches").insert(matchInserts);
  if (matchInsertErr) {
    console.error("[generateGroupsForClassAction] match insert:", matchInsertErr);
    // Rollback groups
    await sb.from("groups").delete().eq("class_id", classId).eq("tournament_id", tournamentId);
    return { error: "สร้างแมตช์กลุ่มไม่สำเร็จ" };
  }

  await writeAuditLog({
    tournament_id: tournamentId,
    actor_id: session.profileId,
    actor_name: session.displayName,
    event_type: "class_groups_generated",
    entity_type: "class",
    entity_id: classId,
    description: `class "${classRow.code}" — สร้าง ${groupPairArrays.length} กลุ่ม, ${matchInserts.length} แมตช์`,
  });

  await revalidateTournamentPaths(sb, tournamentId);
  return { ok: true, groupCount: groupPairArrays.length, matchCount: matchInserts.length };
}

/**
 * Re-generate round-robin matches for a class's existing groups.
 * Deletes only this class's group-round matches (scoped by class_id + round_type).
 * Groups themselves are preserved so any manual edits to group membership
 * (future feature) are not lost. If no groups exist yet, delegates to
 * generateGroupsForClassAction.
 */
export async function generatePairMatchesForClassAction(
  classId: string,
): Promise<{ ok: true; matchCount: number } | { error: string }> {
  const session = await getSession();
  if (!session) return await loginRedirect();

  const sb = await createAdminClient();

  const { data: classRow } = await sb
    .from("tournament_classes")
    .select("id, tournament_id, code, pairs_per_group, format")
    .eq("id", classId)
    .maybeSingle();
  if (!classRow) return { error: "ไม่พบ class" };

  const { tournament_id: tournamentId } = classRow;
  if (!(await assertCanEdit(tournamentId, session.profileId))) return { error: "ไม่มีสิทธิ์" };

  if (classRow.format === "knockout_only") {
    return { error: "class นี้ใช้รูปแบบ knockout_only — ไม่มีรอบกลุ่ม" };
  }

  // Check existing groups for this class.
  const { data: existingGroups } = await sb
    .from("groups")
    .select("id")
    .eq("class_id", classId)
    .eq("tournament_id", tournamentId)
    .order("created_at", { ascending: true });

  if (!existingGroups || existingGroups.length === 0) {
    // No groups yet — delegate to full generation.
    return generateGroupsForClassAction(classId);
  }

  // Load pairs for this class.
  type RawPair = { id: string; team_id: string };
  const { data: pairsRaw } = await sb
    .from("pairs")
    .select("id, team_id")
    .eq("class_id", classId);
  const pairs = (pairsRaw ?? []) as RawPair[];
  if (pairs.length < 2) return { error: "ต้องมีคู่อย่างน้อย 2 คู่ใน class นี้" };

  // Re-derive group assignment deterministically (same input → same groups).
  const groupingResult = balancedTeamGroupAssignment(
    pairs.map((p) => ({ pairId: p.id, teamId: p.team_id })),
    classRow.pairs_per_group,
  );
  if (!groupingResult.ok) return { error: groupingResult.error };

  const { groups: groupPairArrays } = groupingResult;

  if (groupPairArrays.length !== existingGroups.length) {
    // Group count changed — full regeneration needed.
    return generateGroupsForClassAction(classId);
  }

  // Delete existing group-round matches for this class only.
  await sb
    .from("matches")
    .delete()
    .eq("class_id", classId)
    .eq("tournament_id", tournamentId)
    .eq("round_type", "group");

  const pairTeamMap = new Map(pairs.map((p) => [p.id, p.team_id]));
  let nextMatchNum = await getNextGlobalMatchNumber(sb, tournamentId);
  const matchInserts: Record<string, unknown>[] = [];

  for (let gi = 0; gi < groupPairArrays.length; gi++) {
    const groupId = existingGroups[gi].id;
    const groupPairIds = groupPairArrays[gi];

    const singletonTeams = groupPairIds.map((pairId) => ({
      teamId: pairTeamMap.get(pairId) ?? pairId,
      pairIds: [pairId],
    }));

    const rrMatches = generateAllPairMatches(singletonTeams);

    for (const m of rrMatches) {
      matchInserts.push({
        tournament_id: tournamentId,
        class_id: classId,
        group_id: groupId,
        round_type: "group",
        round_number: 1,
        match_number: nextMatchNum++,
        pair_a_id: m.pairAId,
        pair_b_id: m.pairBId,
        division: null,
        status: "pending",
        games: [],
      });
    }
  }

  if (matchInserts.length === 0) {
    return { error: "ไม่สามารถสร้างแมตช์ได้ — ตรวจสอบจำนวนคู่ในกลุ่ม" };
  }

  const { error: matchInsertErr } = await sb.from("matches").insert(matchInserts);
  if (matchInsertErr) {
    console.error("[generatePairMatchesForClassAction] match insert:", matchInsertErr);
    return { error: "สร้างแมตช์คู่ไม่สำเร็จ" };
  }

  await writeAuditLog({
    tournament_id: tournamentId,
    actor_id: session.profileId,
    actor_name: session.displayName,
    event_type: "class_groups_generated",
    entity_type: "class",
    entity_id: classId,
    description: `class "${classRow.code}" — สร้างแมตช์กลุ่มใหม่ ${matchInserts.length} นัด`,
  });

  await revalidateTournamentPaths(sb, tournamentId);
  return { ok: true, matchCount: matchInserts.length };
}

// ============ GENERATE — KNOCKOUT (owner OR co-admin) ============

type Seed = { teamId: string; name: string };

function toEntries(seeds: Seed[], bracketSize: number): BracketEntry[] {
  return [
    ...seeds.map((s) => ({ teamId: s.teamId, label: s.name })),
    ...Array(bracketSize - seeds.length).fill({ teamId: null, label: "BYE" }),
  ];
}

/**
 * Generate knockout bracket for one class from its group-stage standings.
 *
 * - Scoped to this class only (delete + insert by class_id).
 * - division: null on all rows (classes replace divisions — see ASSUMPTIONS).
 * - match_number continues from tournament-global max (no collisions).
 * - BYE cascade loop copied verbatim from generateKnockoutAction pair branch.
 * - applyDivisionPriorityOrdering NOT called (division-based, not class-based).
 * - allow_drop_to_lower: this flag controls the independent-lower-bracket path
 *   in TEAM mode (buildIndependentDoubleBracket). That path is team-mode-only
 *   and private to matches.ts. For pair-mode classes, has_lower_bracket=true
 *   always uses buildDoubleBracket regardless of allow_drop_to_lower — same
 *   behavior as the existing pair-mode generateKnockoutAction.
 * - KNOWN LIMITATION: startMatchAction gates KO-R1 on all group matches with
 *   division=null being completed — with class matches all having division=null,
 *   Class B's knockout is blocked until ALL classes' group matches finish.
 *   Fixing this requires class_id-awareness in startMatchAction (out-of-scope here).
 */
export async function generateKnockoutForClassAction(
  classId: string,
): Promise<{ ok: true; count: number } | { error: string }> {
  const session = await getSession();
  if (!session) return await loginRedirect();

  const sb = await createAdminClient();

  const { data: classRow } = await sb
    .from("tournament_classes")
    .select("id, tournament_id, code, name, format, advance_count, has_lower_bracket, allow_drop_to_lower")
    .eq("id", classId)
    .maybeSingle();
  if (!classRow) return { error: "ไม่พบ class" };

  const { tournament_id: tournamentId } = classRow;
  if (!(await assertCanEdit(tournamentId, session.profileId))) return { error: "ไม่มีสิทธิ์" };

  const format = classRow.format as TournamentFormat;

  // Load this class's pairs with display names.
  type RawPair = {
    id: string;
    player1: { display_name: string } | null;
    player2: { display_name: string } | null;
  };
  const { data: pairsRaw } = await sb
    .from("pairs")
    .select("id, player1:team_players!player_id_1(display_name), player2:team_players!player_id_2(display_name)")
    .eq("class_id", classId);
  const pairs = (pairsRaw as unknown as RawPair[]) ?? [];
  if (pairs.length < 2) return { error: "ต้องมีคู่อย่างน้อย 2 คู่ใน class นี้" };

  function pairSeed(p: RawPair): Seed {
    const label =
      [p.player1?.display_name, p.player2?.display_name].filter(Boolean).join(" / ") ||
      p.id.slice(0, 6);
    return { teamId: p.id, name: label };
  }

  let allMatches: BracketMatchDef[] = [];

  if (format === "group_knockout") {
    // Load all group matches for this class.
    const { data: groupMatchesRaw } = await sb
      .from("matches")
      .select("id, group_id, pair_a_id, pair_b_id, games, winner_id, status, team_a_score, team_b_score, round_type, round_number, match_number, tournament_id, class_id, team_a_id, team_b_id, division, bracket, court, scheduled_at, next_match_id, next_match_slot, loser_next_match_id, loser_next_match_slot, queue_position, started_at, created_at")
      .eq("tournament_id", tournamentId)
      .eq("class_id", classId)
      .eq("round_type", "group");
    const groupMatches = (groupMatchesRaw ?? []) as Match[];

    const advanceCount = classRow.advance_count ?? 2;
    const pairById = new Map(pairs.map((p) => [p.id, p]));

    // CORRECT: advance top-N per group, not top-N overall.
    // Pairs in different groups never played each other, so cross-group ranking
    // is meaningless. Mirror the team-mode generateKnockoutAction approach.

    // Build group_id → pairId[] map by scanning match rows.
    const groupPairMap = new Map<string, Set<string>>();
    for (const m of groupMatches) {
      if (!m.group_id) continue;
      if (!groupPairMap.has(m.group_id)) groupPairMap.set(m.group_id, new Set());
      const grp = groupPairMap.get(m.group_id)!;
      if (m.pair_a_id) grp.add(m.pair_a_id);
      if (m.pair_b_id) grp.add(m.pair_b_id);
    }

    if (groupPairMap.size === 0) {
      return { error: "ยังไม่มีแมตช์รอบกลุ่ม — สร้างกลุ่มก่อน" };
    }

    const seeds: Seed[] = [];
    for (const [groupId, pairIdSet] of groupPairMap) {
      const gMatches = groupMatches.filter((m) => m.group_id === groupId);
      const standings = computeStandings(gMatches, "pair", [...pairIdSet]);
      const topN = standings.slice(0, advanceCount);
      for (const row of topN) {
        const p = pairById.get(row.competitorId);
        if (p) seeds.push(pairSeed(p));
      }
    }

    if (seeds.length < 2) return { error: "คู่ที่ผ่านรอบมีไม่ถึง 2 คู่" };

    const bracketSize = nextPowerOf2(seeds.length);
    allMatches = classRow.has_lower_bracket
      ? buildDoubleBracket(toEntries(seeds, bracketSize))
      : buildBracket(toEntries(seeds, bracketSize));
  } else {
    // knockout_only — seed all pairs directly.
    const seeds: Seed[] = pairs.map(pairSeed);
    const bracketSize = nextPowerOf2(seeds.length);
    allMatches = classRow.has_lower_bracket
      ? buildDoubleBracket(toEntries(seeds, bracketSize))
      : buildBracket(toEntries(seeds, bracketSize));
  }

  // Delete this class's existing knockout matches (scoped — siblings untouched).
  await sb
    .from("matches")
    .delete()
    .eq("class_id", classId)
    .eq("tournament_id", tournamentId)
    .eq("round_type", "knockout");

  // match_number continues from tournament-global max.
  const globalMax = (await getNextGlobalMatchNumber(sb, tournamentId)) - 1;

  const colA = "pair_a_id";
  const colB = "pair_b_id";

  const inserts = allMatches.map((m, i) => ({
    id: m.id,
    tournament_id: tournamentId,
    class_id: classId,
    round_type: "knockout",
    round_number: m.roundNumber,
    match_number: globalMax + i + 1,
    [colA]: m.teamAId,
    [colB]: m.teamBId,
    next_match_id: m.nextMatchId,
    next_match_slot: m.nextMatchSlot,
    loser_next_match_id: m.loserNextMatchId,
    loser_next_match_slot: m.loserNextMatchSlot,
    bracket: m.bracket,
    division: null, // classes replace divisions — see ASSUMPTIONS
    status: "pending",
    games: [],
  }));

  const { error: insertErr } = await sb.from("matches").insert(inserts);
  if (insertErr) {
    console.error("[generateKnockoutForClassAction] insert:", insertErr);
    return { error: "สร้างสายน็อกเอาต์ไม่สำเร็จ" };
  }

  // BYE cascade loop — verbatim from generateKnockoutAction (pair branch).
  const byeMatches = allMatches.filter((m) => m.isBye);
  const lowerByeCandidates = allMatches.filter(
    (m) => m.bracket === "lower" || m.bracket === "grand_final",
  );
  const maxIter = Math.max(2, Math.ceil(Math.log2(Math.max(2, allMatches.length))) + 2);
  let iter = 0;
  let resolvedThisIter = 0;

  while (iter < maxIter) {
    resolvedThisIter = 0;

    if (iter === 0) {
      const completePromises = byeMatches.map((m) => {
        const winnerIs: "a" | "b" = m.teamAId ? "a" : "b";
        const winner = m.teamAId ?? m.teamBId;
        const walkover = byeWalkoverGames(winnerIs);
        return sb
          .from("matches")
          .update({
            status: "completed",
            winner_id: winner,
            games: walkover.games,
            team_a_score: walkover.teamAScore,
            team_b_score: walkover.teamBScore,
          })
          .eq("id", m.id);
      });
      if (completePromises.length) await Promise.all(completePromises);

      const slotPromises = byeMatches.flatMap((m) => {
        const winner = m.teamAId ?? m.teamBId;
        const writes = [];
        if (m.nextMatchId && m.nextMatchSlot && winner) {
          const slot = m.nextMatchSlot === "a" ? colA : colB;
          writes.push(sb.from("matches").update({ [slot]: winner }).eq("id", m.nextMatchId));
        }
        if (m.loserNextMatchId && m.loserNextMatchSlot) {
          const loserSlotCol = m.loserNextMatchSlot === "a" ? colA : colB;
          writes.push(
            sb.from("matches").update({ [loserSlotCol]: null }).eq("id", m.loserNextMatchId),
          );
        }
        return writes;
      });
      if (slotPromises.length) await Promise.all(slotPromises);
      resolvedThisIter += byeMatches.length;
    }

    if (lowerByeCandidates.length > 0) {
      const { data: lowerCurrent } = await sb
        .from("matches")
        .select(
          "id, pair_a_id, pair_b_id, next_match_id, next_match_slot, loser_next_match_id, loser_next_match_slot, status",
        )
        .eq("tournament_id", tournamentId)
        .eq("round_type", "knockout")
        .in(
          "id",
          lowerByeCandidates.map((m) => m.id),
        )
        .eq("status", "pending");

      type LowerRow = {
        id: string;
        pair_a_id: string | null;
        pair_b_id: string | null;
        next_match_id: string | null;
        next_match_slot: "a" | "b" | null;
        loser_next_match_id: string | null;
        loser_next_match_slot: "a" | "b" | null;
      };

      const walkoverable = ((lowerCurrent ?? []) as LowerRow[]).filter((m) => {
        const aId = m.pair_a_id;
        const bId = m.pair_b_id;
        return (aId === null) !== (bId === null);
      });

      const completePromises = walkoverable.map((m) => {
        const aId = m.pair_a_id;
        const bId = m.pair_b_id;
        const winnerIs: "a" | "b" = aId ? "a" : "b";
        const winner = (aId ?? bId)!;
        const walkover = byeWalkoverGames(winnerIs);
        return sb
          .from("matches")
          .update({
            status: "completed",
            winner_id: winner,
            games: walkover.games,
            team_a_score: walkover.teamAScore,
            team_b_score: walkover.teamBScore,
          })
          .eq("id", m.id);
      });
      if (completePromises.length) await Promise.all(completePromises);

      const slotPromises = walkoverable.flatMap((m) => {
        const winner = m.pair_a_id ?? m.pair_b_id;
        const writes = [];
        if (m.next_match_id && m.next_match_slot && winner) {
          const slot = m.next_match_slot === "a" ? colA : colB;
          writes.push(sb.from("matches").update({ [slot]: winner }).eq("id", m.next_match_id));
        }
        if (m.loser_next_match_id && m.loser_next_match_slot) {
          const loserSlotCol = m.loser_next_match_slot === "a" ? colA : colB;
          writes.push(
            sb
              .from("matches")
              .update({ [loserSlotCol]: null })
              .eq("id", m.loser_next_match_id),
          );
        }
        return writes;
      });
      if (slotPromises.length) await Promise.all(slotPromises);
      resolvedThisIter += walkoverable.length;
    }

    iter += 1;
    if (resolvedThisIter === 0) break;
  }

  if (iter >= maxIter && resolvedThisIter > 0) {
    console.warn(
      `[generateKnockoutForClassAction] BYE cascade hit max iterations (${maxIter}) — possible bracket anomaly`,
    );
  }

  const realMatchCount = allMatches.filter((m) => !m.isBye && m.bracket !== "grand_final").length;

  await writeAuditLog({
    tournament_id: tournamentId,
    actor_id: session.profileId,
    actor_name: session.displayName,
    event_type: "bracket_generated",
    entity_type: "class",
    entity_id: classId,
    description: `class "${classRow.code}" — สร้างสายน็อกเอาต์ ${realMatchCount} นัด`,
  });

  await revalidateTournamentPaths(sb, tournamentId);
  return { ok: true, count: realMatchCount };
}
