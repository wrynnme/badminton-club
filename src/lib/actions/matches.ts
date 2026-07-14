"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { getTranslations } from "next-intl/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/auth/session";
import { generateAllPairMatches } from "@/lib/tournament/scheduling";
import { gameWinner, sumGameScores, computeStandings } from "@/lib/tournament/scoring";
import { resolveMatchResult } from "@/lib/tournament/match-format";
import { buildBracket, buildDoubleBracket, nextPowerOf2, selectBracketFillers } from "@/lib/tournament/bracket";
import type { BracketFiller } from "@/lib/tournament/bracket";
import type { BracketEntry, BracketMatchDef } from "@/lib/tournament/bracket";
import type { Game, Match, MatchFormat } from "@/lib/types";
import { assertCanEdit } from "@/lib/tournament/permissions";
import { writeAuditLog } from "@/lib/tournament/audit";
import { notifyTournamentEvent } from "@/lib/notification/line";
import { getTournamentSettings } from "@/lib/tournament/settings.server";
import { computePairDivision, parseDivision, parsePairLevel, parseTournamentThresholds } from "@/lib/tournament/divisions";
import type { TournamentSettings } from "@/lib/tournament/settings";

async function loginRedirect(): Promise<never> {
  const h = await headers();
  const referer = h.get("referer");
  const redirectTo = referer ? new URL(referer).pathname : "/tournaments";
  redirect(`/?auth_error=login_required&redirectTo=${encodeURIComponent(redirectTo)}`);
}

// ============ TEAM MODE ============

export async function generateGroupsAction(tournamentId: string, groupCount: number) {
  const session = await getSession();
  if (!session) return await loginRedirect();
  const t = await getTranslations("actions");
  if (!(await assertCanEdit(tournamentId, session.profileId))) return { error: t("match.noPermission") };

  const sb = await createAdminClient();

  const { data: tournament } = await sb
    .from("tournaments")
    .select("match_unit")
    .eq("id", tournamentId)
    .maybeSingle();
  if (!tournament) return { error: t("match.tournamentNotFound") };
  if (tournament.match_unit !== "team") return { error: t("match.pairModeNoGroups") };

  const { data: teams } = await sb.from("teams").select("id").eq("tournament_id", tournamentId);
  if (!teams?.length) return { error: t("match.noTeams") };

  const shuffled = [...teams].sort(() => Math.random() - 0.5);
  const names = "ABCDEFGHIJKLMNOP".split("").slice(0, groupCount).map((n) => `กลุ่ม ${n}`);
  const assignments = shuffled.map((team, i) => ({ group_index: i % groupCount, team_id: team.id }));

  const { error: rpcError } = await sb.rpc("regenerate_tournament_groups", {
    p_tournament_id: tournamentId,
    p_group_names: names,
    p_assignments: assignments,
  });
  if (rpcError) return { error: t("match.generateGroupsFailed") };

  // Knockout bracket is seeded from group standings — regenerating groups invalidates it.
  const koCleared = await clearKnockoutMatches(sb, tournamentId);

  revalidatePath(`/tournaments/${tournamentId}`);
  await writeAuditLog({
    tournament_id: tournamentId,
    actor_id: session.profileId,
    actor_name: session.displayName,
    event_type: "bracket_generated",
    entity_type: "tournament",
    entity_id: tournamentId,
    description: `สร้างกลุ่ม ${groupCount} กลุ่ม${koCleared ? " (รีเซ็ตสาย knockout)" : ""}`,
  });
  return { ok: true, knockoutCleared: koCleared };
}

/**
 * Get the next sequential `match_number` for a tournament. When `roundType`
 * is provided, the scan is scoped to that round_type (e.g., to continue
 * numbering after group stage when generating the knockout bracket). Without
 * `roundType`, the scan covers every row in the tournament. Returns 1 when
 * no matching rows exist.
 *
 * When `precomputedMax` is provided, the query is skipped entirely and the
 * function returns `precomputedMax + 1`. This avoids a duplicate scan when
 * the caller has already computed the max (e.g. `generateKnockoutAction`
 * computes `groupMax` and passes it down here).
 */
async function getNextMatchNumber(
  sb: Awaited<ReturnType<typeof createAdminClient>>,
  tournamentId: string,
  opts?: { roundType?: "group" | "knockout"; precomputedMax?: number },
): Promise<number> {
  if (opts?.precomputedMax !== undefined) {
    return opts.precomputedMax + 1;
  }
  let q = sb
    .from("matches")
    .select("match_number")
    .eq("tournament_id", tournamentId);
  if (opts?.roundType) q = q.eq("round_type", opts.roundType);
  const { data } = await q
    .order("match_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data?.match_number ?? 0) + 1;
}

type MatchPlayerCollection =
  | { ok: true; ids: string[] }
  | { ok: false; reason: "tbd" | "empty_roster" };

async function collectMatchPlayerIds(
  sb: Awaited<ReturnType<typeof createAdminClient>>,
  match: { team_a_id: string | null; team_b_id: string | null; pair_a_id: string | null; pair_b_id: string | null },
): Promise<MatchPlayerCollection> {
  const hasPair = !!(match.pair_a_id || match.pair_b_id);
  if (hasPair) {
    if (!match.pair_a_id || !match.pair_b_id) return { ok: false, reason: "tbd" };
    const { data, error } = await sb
      .from("pairs")
      .select("player_id_1, player_id_2")
      .in("id", [match.pair_a_id, match.pair_b_id]);
    if (error) throw new Error(`collectMatchPlayerIds pairs: ${error.message}`);
    const ids = new Set<string>();
    for (const p of data ?? []) {
      if (p.player_id_1) ids.add(p.player_id_1);
      if (p.player_id_2) ids.add(p.player_id_2);
    }
    if (ids.size === 0) return { ok: false, reason: "empty_roster" };
    return { ok: true, ids: [...ids] };
  }
  if (!match.team_a_id || !match.team_b_id) return { ok: false, reason: "tbd" };
  const { data, error } = await sb
    .from("team_players")
    .select("id")
    .in("team_id", [match.team_a_id, match.team_b_id]);
  if (error) throw new Error(`collectMatchPlayerIds team_players: ${error.message}`);
  const ids = (data ?? []).map((p) => p.id);
  if (ids.length === 0) return { ok: false, reason: "empty_roster" };
  return { ok: true, ids };
}

async function countUncheckedPlayers(
  sb: Awaited<ReturnType<typeof createAdminClient>>,
  playerIds: string[],
): Promise<number> {
  if (playerIds.length === 0) return 0;
  const { count, error } = await sb
    .from("team_players")
    .select("id", { count: "exact", head: true })
    .in("id", playerIds)
    .is("checked_in_at", null);
  if (error) throw new Error(`countUncheckedPlayers: ${error.message}`);
  return count ?? 0;
}

async function resetGroupTeamStandings(
  sb: Awaited<ReturnType<typeof createAdminClient>>,
  tournamentId: string,
): Promise<void> {
  const { data: groups } = await sb
    .from("groups")
    .select("id")
    .eq("tournament_id", tournamentId);
  const groupIds = (groups ?? []).map((g) => g.id);
  if (!groupIds.length) return;
  const { error } = await sb
    .from("group_teams")
    .update({ wins: 0, draws: 0, losses: 0, points_for: 0, points_against: 0 })
    .in("group_id", groupIds);
  if (error) console.error("[resetGroupTeamStandings]", error);
}

async function clearKnockoutMatches(
  sb: Awaited<ReturnType<typeof createAdminClient>>,
  tournamentId: string,
): Promise<boolean> {
  const { count } = await sb
    .from("matches")
    .select("id", { count: "exact", head: true })
    .eq("tournament_id", tournamentId)
    .eq("round_type", "knockout");
  if (!count) return false;
  const { error } = await sb
    .from("matches")
    .delete()
    .eq("tournament_id", tournamentId)
    .eq("round_type", "knockout");
  if (error) {
    console.error("[clearKnockoutMatches]", error);
    return false;
  }
  return true;
}

export async function generateGroupMatchesAction(tournamentId: string) {
  const session = await getSession();
  if (!session) return await loginRedirect();
  const t = await getTranslations("actions");
  if (!(await assertCanEdit(tournamentId, session.profileId))) return { error: t("match.noPermission") };

  const sb = await createAdminClient();

  const { data: groups } = await sb
    .from("groups")
    .select("id, group_teams(team_id)")
    .eq("tournament_id", tournamentId);
  if (!groups?.length) return { error: t("match.noGroups") };

  type RawGroup = { id: string; group_teams: { team_id: string }[] };
  const inserts: Array<Record<string, unknown>> = [];
  let n = 1;
  for (const g of groups as RawGroup[]) {
    const teamIds = g.group_teams.map((gt) => gt.team_id);
    for (let i = 0; i < teamIds.length; i++) {
      for (let j = i + 1; j < teamIds.length; j++) {
        inserts.push({
          group_id: g.id,
          round_number: 1,
          match_number: n++,
          team_a_id: teamIds[i],
          team_b_id: teamIds[j],
        });
      }
    }
  }

  const { error: rpcError } = await sb.rpc("replace_tournament_matches", {
    p_tournament_id: tournamentId,
    p_round_type: "group",
    p_matches: inserts,
  });
  if (rpcError) return { error: t("match.generateGroupMatchesFailed") };

  // Reset group_teams denormalized standings (wins/draws/losses/points_*) — scores in
  // matches table got wiped by the RPC above but standings were not touched.
  await resetGroupTeamStandings(sb, tournamentId);

  // Regenerating group matches resets all scores → KO bracket seeded from standings is invalid.
  const koCleared = await clearKnockoutMatches(sb, tournamentId);

  revalidatePath(`/tournaments/${tournamentId}`);
  await writeAuditLog({
    tournament_id: tournamentId,
    actor_id: session.profileId,
    actor_name: session.displayName,
    event_type: "bracket_generated",
    entity_type: "tournament",
    entity_id: tournamentId,
    description: `สร้างแมตช์กลุ่ม ${inserts.length} นัด${koCleared ? " (รีเซ็ตสาย knockout)" : ""}`,
  });
  return { ok: true, count: inserts.length, knockoutCleared: koCleared };
}

// ============ PAIR MODE ============

async function applyDivisionPriorityOrdering(
  sb: Awaited<ReturnType<typeof createAdminClient>>,
  tournamentId: string,
  roundType: "group" | "knockout",
  settings?: TournamentSettings,
): Promise<void> {
  const s = settings ?? (await getTournamentSettings(tournamentId));
  const { data: pending } = await sb
    .from("matches")
    .select("id, division, bracket, round_type, match_number")
    .eq("tournament_id", tournamentId)
    .eq("status", "pending")
    .eq("round_type", roundType)
    .order("match_number");
  if (!pending || pending.length < 2) return;
  const divPriority =
    s.queue_division_priority.length > 0
      ? s.queue_division_priority
      : Array.from(
          new Set(
            pending
              .map((m) => parseDivision(m.division))
              .filter((d): d is number => d !== null),
          ),
        ).sort((a, b) => a - b);
  const ordered = orderByDivisionPriority(
    pending.map((m) => ({
      id: m.id,
      division: m.division,
      bracket: m.bracket as "upper" | "lower" | "grand_final" | null,
      round_type: m.round_type as "group" | "knockout",
      match_number: m.match_number,
    })),
    s.queue_division_order,
    divPriority,
    s.queue_chunk_size,
  ).flat();
  const { error } = await sb.rpc("swap_pending_match_numbers", {
    p_tournament_id: tournamentId,
    p_ordered_ids: ordered,
  });
  if (error) console.warn("[applyDivisionPriorityOrdering]", error);
}

export async function generatePairMatchesAction(tournamentId: string) {
  const session = await getSession();
  if (!session) return await loginRedirect();
  const t = await getTranslations("actions");
  if (!(await assertCanEdit(tournamentId, session.profileId))) return { error: t("match.noPermission") };

  const sb = await createAdminClient();

  // Fetch tournament thresholds + pairs
  const { data: tournament } = await sb.from("tournaments").select("pair_division_thresholds").eq("id", tournamentId).single();
  const thresholds: number[] = parseTournamentThresholds(tournament?.pair_division_thresholds);

  const { data: teams } = await sb
    .from("teams")
    .select("id, pairs(id, player_id_1, player_id_2, pair_level)")
    .eq("tournament_id", tournamentId);
  if (!teams?.length) return { error: t("match.noTeams") };

  type RawPair = { id: string; player_id_1: string | null; player_id_2: string | null; pair_level: string | null };
  type RawTeam = { id: string; pairs: RawPair[] };

  const allTeamPairs = (teams as unknown as RawTeam[]).map((t) => ({
    teamId: t.id,
    pairs: t.pairs.filter((p) => p.player_id_1 && p.player_id_2),
  }));

  type MatchInsert = { round_number: number; match_number: number; team_a_id: string; team_b_id: string; pair_a_id: string; pair_b_id: string; division: string | null };
  let allMatchInserts: MatchInsert[] = [];

  if (thresholds.length === 0) {
    // No division — all pairs compete together
    const teamPairs = allTeamPairs
      .map((t) => ({ teamId: t.teamId, pairIds: t.pairs.map((p) => p.id) }))
      .filter((tp) => tp.pairIds.length > 0);
    if (teamPairs.length < 2) return { error: t("match.needTwoTeamsWithPairs") };
    const all = generateAllPairMatches(teamPairs);
    allMatchInserts = all.map((m, i) => ({
      round_number: 1, match_number: i + 1,
      team_a_id: m.teamAId, team_b_id: m.teamBId, pair_a_id: m.pairAId, pair_b_id: m.pairBId,
      division: null,
    }));
  } else {
    // N-way division split — group pairs by computed division index
    const divisionMap = new Map<number, RawPair[]>();
    for (const t of allTeamPairs) {
      for (const p of t.pairs) {
        const d = computePairDivision(parsePairLevel(p.pair_level), thresholds);
        // d is always a number here since thresholds.length > 0
        const key = d as number;
        if (!divisionMap.has(key)) divisionMap.set(key, []);
        divisionMap.get(key)!.push(p);
      }
    }

    let matchNum = 1;
    let anyGenerated = false;
    // Sort divisions ascending (1 = top tier first)
    const divKeys = Array.from(divisionMap.keys()).sort((a, b) => a - b);
    for (const d of divKeys) {
      // Build per-division teamPairs list (pairs grouped by their team)
      const divPairIds = new Set((divisionMap.get(d) ?? []).map((p) => p.id));
      const divTeamPairs = allTeamPairs
        .map((t) => ({ teamId: t.teamId, pairIds: t.pairs.filter((p) => divPairIds.has(p.id)).map((p) => p.id) }))
        .filter((tp) => tp.pairIds.length > 0);
      if (divTeamPairs.length < 2) continue;
      const divMatches = generateAllPairMatches(divTeamPairs);
      for (const m of divMatches) {
        allMatchInserts.push({
          round_number: 1, match_number: matchNum++,
          team_a_id: m.teamAId, team_b_id: m.teamBId,
          pair_a_id: m.pairAId, pair_b_id: m.pairBId,
          division: String(d),
        });
      }
      if (divMatches.length > 0) anyGenerated = true;
    }
    if (!anyGenerated) return { error: t("match.needTwoTeamsPerDivision") };
  }

  const { error: rpcError } = await sb.rpc("replace_tournament_matches", {
    p_tournament_id: tournamentId,
    p_round_type: "group",
    p_matches: allMatchInserts,
  });
  if (rpcError) return { error: t("match.generatePairMatchesFailed") };

  // Apply division-priority ordering immediately so users don't need
  // to click "จัดคิวอัตโนมัติ" after generation.
  await applyDivisionPriorityOrdering(sb, tournamentId, "group");

  // Regenerating pair matches resets all scores → KO bracket seeded from standings is invalid.
  const koCleared = await clearKnockoutMatches(sb, tournamentId);

  revalidatePath(`/tournaments/${tournamentId}`);
  await writeAuditLog({
    tournament_id: tournamentId,
    actor_id: session.profileId,
    actor_name: session.displayName,
    event_type: "bracket_generated",
    entity_type: "tournament",
    entity_id: tournamentId,
    description: `สร้างแมตช์คู่ ${allMatchInserts.length} นัด${koCleared ? " (รีเซ็ตสาย knockout)" : ""}`,
  });
  return { ok: true, count: allMatchInserts.length, knockoutCleared: koCleared };
}

// ============ KNOCKOUT ============

type Seed = { teamId: string; name: string };

type GroupTeamRow = {
  team_id: string;
  wins: number;
  draws: number;
  losses: number;
  points_for: number;
  points_against: number;
  team: { id: string; name: string; color: string | null } | null;
};

function rankGroupTeams(groupTeams: GroupTeamRow[]): Array<Seed & { pts: number; diff: number; pf: number }> {
  return groupTeams
    .map((gt) => ({
      teamId: gt.team_id,
      name: gt.team?.name ?? "—",
      pts: gt.wins * 3 + gt.draws,
      diff: gt.points_for - gt.points_against,
      pf: gt.points_for,
    }))
    .sort((a, b) => b.pts - a.pts || b.diff - a.diff || b.pf - a.pf);
}

function toEntries(seeds: Seed[], bracketSize: number): BracketEntry[] {
  return [
    ...seeds.map((s) => ({ teamId: s.teamId, label: s.name })),
    ...Array(bracketSize - seeds.length).fill({ teamId: null, label: "BYE" }),
  ];
}

function buildIndependentDoubleBracket(upperSeeds: Seed[], lowerSeeds: Seed[]): BracketMatchDef[] {
  const upperSize = nextPowerOf2(upperSeeds.length);
  const lowerSize = nextPowerOf2(lowerSeeds.length);
  const upperMatches = buildBracket(toEntries(upperSeeds, upperSize));
  const lowerMatchesRaw = buildBracket(toEntries(lowerSeeds, lowerSize));

  const grandFinalId = crypto.randomUUID();
  const offset = upperMatches.length;
  const lowerMatches = lowerMatchesRaw.map((m, i) => ({ ...m, matchNumber: offset + i + 1, bracket: "lower" as const }));

  // Point both finals to grand final
  const upperFinal = upperMatches[upperMatches.length - 1];
  upperFinal.nextMatchId = grandFinalId;
  upperFinal.nextMatchSlot = "a";

  const lowerFinal = lowerMatches[lowerMatches.length - 1];
  lowerFinal.nextMatchId = grandFinalId;
  lowerFinal.nextMatchSlot = "b";

  const grandFinal: BracketMatchDef = {
    id: grandFinalId,
    roundNumber: Math.max(upperFinal.roundNumber, lowerFinal.roundNumber) + 1,
    matchNumber: offset + lowerMatches.length + 1,
    teamAId: null, teamBId: null,
    nextMatchId: null, nextMatchSlot: null,
    loserNextMatchId: null, loserNextMatchSlot: null,
    bracket: "grand_final", isBye: false,
  };

  return [...upperMatches, ...lowerMatches, grandFinal];
}

// BYE walkover convention (Thai pair tournaments / วีนฉ่ำ): winner gets 21-15 in both sets.
// Stored so standings tiebreak (point diff, points-for) reflects real walkover scoring,
// instead of 0-0 which makes BYE wins look identical to a no-show.
function byeWalkoverGames(winnerIs: "a" | "b"): { games: { a: number; b: number }[]; teamAScore: number; teamBScore: number } {
  return winnerIs === "a"
    ? { games: [{ a: 21, b: 15 }, { a: 21, b: 15 }], teamAScore: 2, teamBScore: 0 }
    : { games: [{ a: 15, b: 21 }, { a: 15, b: 21 }], teamAScore: 0, teamBScore: 2 };
}

async function insertAndResolveByes(
  sb: Awaited<ReturnType<typeof createAdminClient>>,
  tournamentId: string,
  allMatches: BracketMatchDef[],
  isPair = false,
  matchNumberOffset = 0,
) {
  const colA = isPair ? "pair_a_id" : "team_a_id";
  const colB = isPair ? "pair_b_id" : "team_b_id";

  const inserts = allMatches.map((m) => ({
    id: m.id,
    round_number: m.roundNumber,
    match_number: m.matchNumber + matchNumberOffset,
    [colA]: m.teamAId,
    [colB]: m.teamBId,
    next_match_id: m.nextMatchId,
    next_match_slot: m.nextMatchSlot,
    loser_next_match_id: m.loserNextMatchId,
    loser_next_match_slot: m.loserNextMatchSlot,
    bracket: m.bracket,
    status: "pending",
    games: [],
  }));

  const { error } = await sb.rpc("replace_tournament_matches", {
    p_tournament_id: tournamentId,
    p_round_type: "knockout",
    p_matches: inserts,
  });
  if (error) return { error: "generateKnockoutFailed" };

  // Auto-complete BYE matches and advance winners. Lower-bracket BYE chains can
  // cascade > 2 rounds (e.g. deep double-elim with sparse seeds), so we loop
  // until no more walkovers are produced. Cap iterations at log2(bracket) + 2
  // as a safety net to prevent infinite loops on malformed data.
  const byeMatches = allMatches.filter((m) => m.isBye);
  const lowerByeCandidates = allMatches.filter((m) => m.bracket === "lower" || m.bracket === "grand_final");
  const maxIter = Math.max(2, Math.ceil(Math.log2(Math.max(2, allMatches.length))) + 2);
  let iter = 0;
  let resolvedThisIter = 0;
  while (iter < maxIter) {
    resolvedThisIter = 0;

    // Iteration 0 — upper BYEs (winner advances + loser slot explicitly nulled
    // so the lower-bracket pass can detect a single-null row next iteration).
    if (iter === 0) {
      for (const m of byeMatches) {
        const winnerIs: "a" | "b" = m.teamAId ? "a" : "b";
        const winner = m.teamAId ?? m.teamBId;
        const walkover = byeWalkoverGames(winnerIs);
        await sb.from("matches").update({
          status: "completed",
          winner_id: winner,
          games: walkover.games,
          team_a_score: walkover.teamAScore,
          team_b_score: walkover.teamBScore,
        }).eq("id", m.id);
        if (m.nextMatchId && m.nextMatchSlot && winner) {
          const slot = m.nextMatchSlot === "a" ? colA : colB;
          await sb.from("matches").update({ [slot]: winner }).eq("id", m.nextMatchId);
        }
        // Fix 2 — BYE has no real loser; explicitly null the loser_next_match
        // slot so the next iteration's single-null filter walks it over.
        if (m.loserNextMatchId && m.loserNextMatchSlot) {
          const loserSlotCol = m.loserNextMatchSlot === "a" ? colA : colB;
          await sb.from("matches").update({ [loserSlotCol]: null }).eq("id", m.loserNextMatchId);
        }
        resolvedThisIter += 1;
      }
    }

    // Every iteration — sweep lower-bracket pending rows with exactly one side null
    if (lowerByeCandidates.length > 0) {
      const { data: lowerCurrent } = await sb
        .from("matches")
        .select("id, team_a_id, team_b_id, pair_a_id, pair_b_id, next_match_id, next_match_slot, loser_next_match_id, loser_next_match_slot, status")
        .eq("tournament_id", tournamentId)
        .eq("round_type", "knockout")
        .in("id", lowerByeCandidates.map((m) => m.id))
        .eq("status", "pending");

      for (const m of lowerCurrent ?? []) {
        const aId = (isPair ? m.pair_a_id : m.team_a_id) as string | null;
        const bId = (isPair ? m.pair_b_id : m.team_b_id) as string | null;
        if ((aId === null) === (bId === null)) continue; // both null or both real
        const winnerIs: "a" | "b" = aId ? "a" : "b";
        const winner = aId ?? bId;
        const walkover = byeWalkoverGames(winnerIs);
        await sb.from("matches").update({
          status: "completed",
          winner_id: winner,
          games: walkover.games,
          team_a_score: walkover.teamAScore,
          team_b_score: walkover.teamBScore,
        }).eq("id", m.id);
        if (m.next_match_id && m.next_match_slot && winner) {
          const slot = m.next_match_slot === "a" ? colA : colB;
          await sb.from("matches").update({ [slot]: winner }).eq("id", m.next_match_id);
        }
        // Propagate null-loser downward so the chain can keep cascading.
        if (m.loser_next_match_id && m.loser_next_match_slot) {
          const loserSlotCol = m.loser_next_match_slot === "a" ? colA : colB;
          await sb.from("matches").update({ [loserSlotCol]: null }).eq("id", m.loser_next_match_id);
        }
        resolvedThisIter += 1;
      }
    }

    iter += 1;
    if (resolvedThisIter === 0) break;
  }
  if (iter >= maxIter && resolvedThisIter > 0) {
    console.warn(`[insertAndResolveByes] BYE cascade hit max iterations (${maxIter}) — possible bracket anomaly`);
  }

  return null; // no error
}

export async function generateKnockoutAction(tournamentId: string) {
  const session = await getSession();
  if (!session) return await loginRedirect();
  const t = await getTranslations("actions");
  if (!(await assertCanEdit(tournamentId, session.profileId))) return { error: t("match.noPermission") };

  const sb = await createAdminClient();

  const { data: tournament } = await sb
    .from("tournaments")
    .select("advance_count, seeding_method, format, has_lower_bracket, allow_drop_to_lower, match_unit, pair_division_thresholds")
    .eq("id", tournamentId)
    .single();
  if (!tournament) return { error: t("match.tournamentNotFound") };

  // T2 — knockout_fill_byes (team-mode group_knockout): read once here.
  const settings = await getTournamentSettings(tournamentId);

  // KO match_number ต่อจาก group stage (max group match_number; 0 ถ้าไม่มี).
  // Subsequent `getNextMatchNumber` calls inside this action should reuse this via
  // `{ precomputedMax: groupMax }` to skip the redundant max(match_number) round-trip.
  const groupMax = (await getNextMatchNumber(sb, tournamentId, { roundType: "group" })) - 1;

  // ── Pair mode ──
  if (tournament.match_unit === "pair") {
    const { data: teamsData } = await sb.from("teams").select("id").eq("tournament_id", tournamentId);
    const teamIds = teamsData?.map((t) => t.id) ?? [];
    if (!teamIds.length) return { error: t("match.noTeams") };

    type RawPair = {
      id: string;
      pair_level: string | null;
      player1: { display_name: string } | null;
      player2: { display_name: string } | null;
    };
    const { data: pairsRaw } = await sb
      .from("pairs")
      .select("id, pair_level, player1:team_players!player_id_1(display_name), player2:team_players!player_id_2(display_name)")
      .in("team_id", teamIds);
    const pairs = (pairsRaw as unknown as RawPair[]) ?? [];
    if (pairs.length < 2) return { error: t("match.needTwoPairs") };

    const thresholds: number[] = parseTournamentThresholds(tournament.pair_division_thresholds);

    function pairSeed(p: RawPair): Seed {
      const label = [p.player1?.display_name, p.player2?.display_name].filter(Boolean).join(" / ") || p.id.slice(0, 6);
      return { teamId: p.id, name: label };
    }

    // Precompute division per pair once — avoids O(D·P²) `pairs.find()` inside division loops
    const divByPairId = new Map<string, number | null>(
      pairs.map((p) => [
        p.id,
        thresholds.length === 0 ? null : computePairDivision(parsePairLevel(p.pair_level), thresholds),
      ]),
    );

    // Collect all BracketMatchDef across all divisions; tag each with division string
    let allMatches: BracketMatchDef[] = [];

    if (tournament.format === "group_knockout") {
      const { data: groupMatchesRaw } = await sb
        .from("matches").select("*").eq("tournament_id", tournamentId).eq("round_type", "group");
      const groupMatches = (groupMatchesRaw ?? []) as Match[];
      const advanceCount = tournament.advance_count ?? 2;

      function seedsFromStandings(rows: ReturnType<typeof computeStandings>, count: number): Seed[] {
        return rows
          .slice(0, count)
          .map((s) => {
            const p = pairs.find((x) => x.id === s.competitorId);
            return p ? pairSeed(p) : null;
          })
          .filter((s): s is Seed => s !== null);
      }

      if (thresholds.length === 0) {
        // No division split — single bracket from all pairs
        const standings = computeStandings(groupMatches, "pair", pairs.map((p) => p.id));
        let topSeeds = seedsFromStandings(standings, advanceCount);
        if (topSeeds.length < 2) return { error: t("match.notEnoughPairsAdvanced") };
        if (tournament.seeding_method === "random") topSeeds = [...topSeeds].sort(() => Math.random() - 0.5);
        allMatches = buildBracket(toEntries(topSeeds, nextPowerOf2(topSeeds.length)));
      } else {
        // N-division: independent bracket per division
        // Invariant: divByPairId values are always in [1..divCount] — computePairDivision
        // clamps via `N - 1 - i` (max) and `N` fallback (min), so the d-equality below never misses.
        const divCount = thresholds.length + 1;
        let anyBuilt = false;
        let matchNumOffset = 0;
        for (let d = 1; d <= divCount; d++) {
          const divPairIds = pairs.filter((p) => divByPairId.get(p.id) === d).map((p) => p.id);
          if (divPairIds.length < 2) continue;
          const standings = computeStandings(groupMatches, "pair", divPairIds);
          let divSeeds = seedsFromStandings(standings, advanceCount);
          if (divSeeds.length < 2) continue;
          if (tournament.seeding_method === "random") divSeeds = [...divSeeds].sort(() => Math.random() - 0.5);
          const divMatches = tournament.has_lower_bracket
            ? buildDoubleBracket(toEntries(divSeeds, nextPowerOf2(divSeeds.length)))
            : buildBracket(toEntries(divSeeds, nextPowerOf2(divSeeds.length)));
          // Renumber matchNumbers to avoid collision across divisions and tag division
          const offset = matchNumOffset;
          const tagged = divMatches.map((m, i) => ({
            ...m,
            matchNumber: offset + i + 1,
            // Store division on the match def via a custom property (used in insert)
            _division: String(d),
          }));
          allMatches = [...allMatches, ...tagged];
          matchNumOffset += divMatches.length;
          anyBuilt = true;
        }
        if (!anyBuilt) return { error: t("match.noEnoughPairsInAnyDivision") };
      }
    } else {
      // knockout_only
      if (thresholds.length === 0) {
        let pairSeeds = pairs.map(pairSeed);
        if (tournament.seeding_method === "random") pairSeeds = pairSeeds.sort(() => Math.random() - 0.5);
        allMatches = buildBracket(toEntries(pairSeeds, nextPowerOf2(pairSeeds.length)));
      } else {
        const divCount = thresholds.length + 1;
        let matchNumOffset = 0;
        for (let d = 1; d <= divCount; d++) {
          const divPairs = pairs.filter((p) => divByPairId.get(p.id) === d);
          if (divPairs.length < 2) continue;
          let divSeeds = divPairs.map(pairSeed);
          if (tournament.seeding_method === "random") divSeeds = divSeeds.sort(() => Math.random() - 0.5);
          const divMatches = tournament.has_lower_bracket
            ? buildDoubleBracket(toEntries(divSeeds, nextPowerOf2(divSeeds.length)))
            : buildBracket(toEntries(divSeeds, nextPowerOf2(divSeeds.length)));
          const offset = matchNumOffset;
          const tagged = divMatches.map((m, i) => ({
            ...m,
            matchNumber: offset + i + 1,
            _division: String(d),
          }));
          allMatches = [...allMatches, ...tagged];
          matchNumOffset += divMatches.length;
        }
        if (!allMatches.length) return { error: t("match.needTwoPairsPerDivision") };
      }
    }

    // Build inserts — inherit division from _division tag; null when no thresholds
    const colA = "pair_a_id";
    const colB = "pair_b_id";
    const inserts = allMatches.map((m) => {
      const tagged = m as BracketMatchDef & { _division?: string };
      return {
        id: m.id,
        round_number: m.roundNumber,
        match_number: m.matchNumber + groupMax,
        [colA]: m.teamAId,
        [colB]: m.teamBId,
        next_match_id: m.nextMatchId,
        next_match_slot: m.nextMatchSlot,
        loser_next_match_id: m.loserNextMatchId,
        loser_next_match_slot: m.loserNextMatchSlot,
        bracket: m.bracket,
        division: tagged._division ?? null,
        status: "pending",
        games: [],
      };
    });

    const { error: insertErr } = await sb.rpc("replace_tournament_matches", {
      p_tournament_id: tournamentId,
      p_round_type: "knockout",
      p_matches: inserts,
    });
    if (insertErr) return { error: t("match.generateKnockoutFailed") };

    // Resolve BYEs inline (cannot reuse insertAndResolveByes because division is now on inserts).
    // Loop until no more walkovers are produced — cascading lower-bracket BYE chains in
    // double-elim can extend > 2 rounds when seeds are sparse. Safety cap at log2 + 2
    // iterations to prevent infinite loops on malformed bracket data. Within each
    // iteration the completion UPDATEs and slot UPDATEs are batched via Promise.all.
    const byeMatches = allMatches.filter((m) => m.isBye);
    const lowerByeCandidates = allMatches.filter((m) => m.bracket === "lower" || m.bracket === "grand_final");
    const maxIter = Math.max(2, Math.ceil(Math.log2(Math.max(2, allMatches.length))) + 2);
    let iter = 0;
    let resolvedThisIter = 0;
    while (iter < maxIter) {
      resolvedThisIter = 0;

      // Iteration 0 — upper BYEs (winner advances + loser slot explicitly nulled
      // so the lower-bracket sweep can detect a single-null row next iteration).
      if (iter === 0) {
        const completePromises = byeMatches.map((m) => {
          const winnerIs: "a" | "b" = m.teamAId ? "a" : "b";
          const winner = m.teamAId ?? m.teamBId;
          const walkover = byeWalkoverGames(winnerIs);
          return sb.from("matches").update({
            status: "completed",
            winner_id: winner,
            games: walkover.games,
            team_a_score: walkover.teamAScore,
            team_b_score: walkover.teamBScore,
          }).eq("id", m.id);
        });
        if (completePromises.length) await Promise.all(completePromises);

        const slotPromises = byeMatches.flatMap((m) => {
          const winner = m.teamAId ?? m.teamBId;
          const writes = [];
          if (m.nextMatchId && m.nextMatchSlot && winner) {
            const slot = m.nextMatchSlot === "a" ? colA : colB;
            writes.push(sb.from("matches").update({ [slot]: winner }).eq("id", m.nextMatchId));
          }
          // Fix 2 — BYE has no real loser; explicitly null the loser_next_match
          // slot so the next iteration's single-null filter walks it over.
          if (m.loserNextMatchId && m.loserNextMatchSlot) {
            const loserSlotCol = m.loserNextMatchSlot === "a" ? colA : colB;
            writes.push(sb.from("matches").update({ [loserSlotCol]: null }).eq("id", m.loserNextMatchId));
          }
          return writes;
        });
        if (slotPromises.length) await Promise.all(slotPromises);
        resolvedThisIter += byeMatches.length;
      }

      // Every iteration — sweep lower-bracket pending rows with exactly one side null
      if (lowerByeCandidates.length > 0) {
        const { data: lowerCurrent } = await sb
          .from("matches")
          .select("id, pair_a_id, pair_b_id, next_match_id, next_match_slot, loser_next_match_id, loser_next_match_slot, status")
          .eq("tournament_id", tournamentId)
          .eq("round_type", "knockout")
          .in("id", lowerByeCandidates.map((m) => m.id))
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
          return (aId === null) !== (bId === null); // exactly one side null
        });

        const completePromises = walkoverable.map((m) => {
          const aId = m.pair_a_id;
          const bId = m.pair_b_id;
          const winnerIs: "a" | "b" = aId ? "a" : "b";
          const winner = (aId ?? bId)!;
          const walkover = byeWalkoverGames(winnerIs);
          return sb.from("matches").update({
            status: "completed",
            winner_id: winner,
            games: walkover.games,
            team_a_score: walkover.teamAScore,
            team_b_score: walkover.teamBScore,
          }).eq("id", m.id);
        });
        if (completePromises.length) await Promise.all(completePromises);

        const slotPromises = walkoverable.flatMap((m) => {
          const winner = m.pair_a_id ?? m.pair_b_id;
          const writes = [];
          if (m.next_match_id && m.next_match_slot && winner) {
            const slot = m.next_match_slot === "a" ? colA : colB;
            writes.push(sb.from("matches").update({ [slot]: winner }).eq("id", m.next_match_id));
          }
          // Propagate null-loser downward so the chain can keep cascading.
          if (m.loser_next_match_id && m.loser_next_match_slot) {
            const loserSlotCol = m.loser_next_match_slot === "a" ? colA : colB;
            writes.push(sb.from("matches").update({ [loserSlotCol]: null }).eq("id", m.loser_next_match_id));
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
      console.warn(`[generateKnockoutAction:pair] BYE cascade hit max iterations (${maxIter}) — possible bracket anomaly`);
    }

    // Apply division-priority ordering immediately after bracket insert.
    await applyDivisionPriorityOrdering(sb, tournamentId, "knockout");

    revalidatePath(`/tournaments/${tournamentId}`);
    await writeAuditLog({
      tournament_id: tournamentId,
      actor_id: session.profileId,
      actor_name: session.displayName,
      event_type: "bracket_generated",
      entity_type: "tournament",
      entity_id: tournamentId,
      description: "สร้างสายน็อกเอาต์",
    });
    notifyTournamentEvent(tournamentId, "bracket", "notifyBracket").catch(() => {});
    return { ok: true, count: allMatches.filter((m) => !m.isBye).length };
  }

  // ── Team mode ──
  let seeds: Seed[];
  let lowerSeeds: Seed[] = [];

  if (tournament.format === "knockout_only") {
    const { data: allTeams } = await sb
      .from("teams").select("id, name").eq("tournament_id", tournamentId).order("created_at");
    if (!allTeams || allTeams.length < 2) return { error: t("match.needTwoTeams") };
    const list = tournament.seeding_method === "random"
      ? [...allTeams].sort(() => Math.random() - 0.5) : allTeams;
    seeds = list.map((t) => ({ teamId: t.id, name: t.name }));
  } else {
    const { data: groups } = await sb
      .from("groups")
      .select("id, group_teams(team_id, wins, draws, losses, points_for, points_against, team:teams(id, name, color))")
      .eq("tournament_id", tournamentId);
    if (!groups?.length) return { error: t("match.noGroupsYet") };

    const advanceCount = tournament.advance_count ?? 2;
    type Advancer = Seed & { groupRank: number; pts: number; diff: number; pf: number };
    const advancers: Advancer[] = [];
    const lowerAdvancers: Advancer[] = [];
    // T2: non-advancing teams kept as candidates to fill empty bracket slots
    // (best Nth place). Only collected on the non-independent-lower path — when an
    // independent lower bracket is active it already consumes the next-rank teams.
    const restAdvancers: BracketFiller[] = [];
    const independentLower = tournament.has_lower_bracket && !tournament.allow_drop_to_lower;

    for (const group of groups) {
      const ranked = rankGroupTeams(group.group_teams as unknown as GroupTeamRow[]);
      ranked.slice(0, advanceCount).forEach((t, i) => advancers.push({ ...t, groupRank: i + 1 }));
      if (independentLower) {
        ranked.slice(advanceCount, advanceCount * 2).forEach((t, i) =>
          lowerAdvancers.push({ ...t, groupRank: i + 1 })
        );
      } else {
        ranked.slice(advanceCount).forEach((t, i) =>
          restAdvancers.push({ ...t, groupRank: advanceCount + i + 1 })
        );
      }
    }

    if (advancers.length < 2) return { error: t("match.notEnoughAdvancers") };

    // T2 — knockout_fill_byes: replace first-round BYEs with the best non-advancing
    // teams (cross-group, ranked by finishing position then score). Gated off the
    // independent-lower path above; no-op when the bracket is already full.
    if (settings.knockout_fill_byes && !independentLower) {
      const need = nextPowerOf2(advancers.length) - advancers.length;
      for (const f of selectBracketFillers(restAdvancers, need)) {
        advancers.push({ teamId: f.teamId, name: f.name, groupRank: f.groupRank, pts: f.pts, diff: f.diff, pf: f.pf });
      }
    }

    seeds = tournament.seeding_method === "by_group_score"
      ? [...advancers].sort((a, b) => a.groupRank - b.groupRank || b.pts - a.pts || b.diff - a.diff || b.pf - a.pf)
      : [...advancers].sort(() => Math.random() - 0.5);

    if (lowerAdvancers.length >= 2) {
      lowerSeeds = tournament.seeding_method === "by_group_score"
        ? [...lowerAdvancers].sort((a, b) => a.groupRank - b.groupRank || b.pts - a.pts || b.diff - a.diff || b.pf - a.pf)
        : [...lowerAdvancers].sort(() => Math.random() - 0.5);
    }
  }

  const bracketSize = nextPowerOf2(seeds.length);
  const entries = toEntries(seeds, bracketSize);

  let allMatches: BracketMatchDef[];

  if (tournament.has_lower_bracket && tournament.allow_drop_to_lower && bracketSize >= 4) {
    allMatches = buildDoubleBracket(entries);
  } else if (tournament.has_lower_bracket && !tournament.allow_drop_to_lower && lowerSeeds.length >= 2) {
    allMatches = buildIndependentDoubleBracket(seeds, lowerSeeds);
  } else {
    allMatches = buildBracket(entries);
  }

  const err = await insertAndResolveByes(sb, tournamentId, allMatches, false, groupMax);
  if (err) return { error: t("match.generateKnockoutFailed") };

  // Apply division-priority ordering immediately after bracket insert.
  await applyDivisionPriorityOrdering(sb, tournamentId, "knockout");

  revalidatePath(`/tournaments/${tournamentId}`);
  await writeAuditLog({
    tournament_id: tournamentId,
    actor_id: session.profileId,
    actor_name: session.displayName,
    event_type: "bracket_generated",
    entity_type: "tournament",
    entity_id: tournamentId,
    description: `สร้างสายน็อกเอาต์`,
  });
  notifyTournamentEvent(tournamentId, "bracket", "notifyBracket").catch(() => {});
  return { ok: true, count: allMatches.filter((m) => !m.isBye && m.bracket !== "grand_final").length };
}

// ============ MANUAL MATCH ============

export async function createManualMatchAction(input: {
  tournamentId: string;
  pairAId: string;
  pairBId: string;
}) {
  const session = await getSession();
  if (!session) return await loginRedirect();
  const t = await getTranslations("actions");
  if (!(await assertCanEdit(input.tournamentId, session.profileId))) return { error: t("match.noPermission") };
  if (input.pairAId === input.pairBId) return { error: t("match.pairsMustBeDifferent") };

  const sb = await createAdminClient();

  // Phase 11 — owner can disable manual match creation once bracket exists
  const settings = await getTournamentSettings(input.tournamentId);
  if (!settings.allow_manual_match_after_bracket) {
    const { data: hasKo } = await sb
      .from("matches")
      .select("id")
      .eq("tournament_id", input.tournamentId)
      .eq("round_type", "knockout")
      .limit(1)
      .maybeSingle();
    if (hasKo) return { error: t("match.manualMatchDisabledAfterBracket") };
  }

  const { data: pairsData } = await sb
    .from("pairs")
    .select("id, team_id, pair_level, teams!inner(tournament_id)")
    .in("id", [input.pairAId, input.pairBId]);

  if (!pairsData || pairsData.length !== 2) return { error: t("match.pairNotFound") };

  for (const p of pairsData) {
    const tid = (p.teams as unknown as { tournament_id: string }).tournament_id;
    if (tid !== input.tournamentId) return { error: t("match.pairNotInTournament") };
  }

  const pA = pairsData.find((p) => p.id === input.pairAId)!;
  const pB = pairsData.find((p) => p.id === input.pairBId)!;

  const { data: tournament } = await sb
    .from("tournaments")
    .select("pair_division_thresholds")
    .eq("id", input.tournamentId)
    .single();

  const thresholds: number[] = parseTournamentThresholds(tournament?.pair_division_thresholds);

  function pairDivNum(level: string | null | undefined): number | null {
    if (thresholds.length === 0) return null;
    return computePairDivision(parsePairLevel(level), thresholds);
  }

  const divA = pairDivNum(pA.pair_level as string | null);
  const divB = pairDivNum(pB.pair_level as string | null);
  if (divA !== divB) return { error: t("match.pairsDifferentDivision") };

  const nextMatchNumber = await getNextMatchNumber(sb, input.tournamentId, { roundType: "group" });

  // P1-A fix: INSERT + tail-position assignment are now atomic inside the RPC
  // so concurrent createManualMatchAction calls cannot produce duplicate queue_position.
  const { error, data: newMatchId } = await sb.rpc("create_manual_match", {
    p_tournament_id: input.tournamentId,
    p_team_a_id: pA.team_id,
    p_team_b_id: pB.team_id,
    p_pair_a_id: input.pairAId,
    p_pair_b_id: input.pairBId,
    p_match_number: nextMatchNumber,
    p_division: divA === null ? null : String(divA),
  });

  if (error) {
    console.error("[createManualMatchAction]", error);
    return { error: t("match.createMatchFailed") };
  }

  revalidatePath(`/tournaments/${input.tournamentId}`);
  await writeAuditLog({
    tournament_id: input.tournamentId,
    actor_id: session.profileId,
    actor_name: session.displayName,
    event_type: "match_created",
    entity_type: "match",
    entity_id: (newMatchId as string | null) ?? undefined,
    description: "สร้างแมตช์ manual",
  });
  return { ok: true };
}

// ============ SCORE ENTRY ============

export async function recordMatchScoreAction(input: {
  matchId: string;
  tournamentId: string;
  games: Game[];
}) {
  const session = await getSession();
  if (!session) return await loginRedirect();
  const t = await getTranslations("actions");
  if (!(await assertCanEdit(input.tournamentId, session.profileId))) return { error: t("match.noPermission") };

  if (!input.games.length) return { error: t("match.resolve_no_games") };
  // Validate each game's scores are integers within [0, 99] (ScoreForm clamps to
  // this; a direct action call could pass negatives/NaN/huge values that corrupt
  // point totals + group standings — server validated only games.length before).
  for (const g of input.games) {
    if (!Number.isInteger(g.a) || !Number.isInteger(g.b) || g.a < 0 || g.b < 0 || g.a > 99 || g.b > 99) {
      return { error: t("match.invalidGameScore") };
    }
  }

  const sb = await createAdminClient();

  const { data: match } = await sb.from("matches").select("*").eq("id", input.matchId).single();
  if (!match) return { error: t("match.notFound") };
  // Scope the write to the authorized tournament — assertCanEdit only proved rights
  // on input.tournamentId, NOT that this match belongs to it. Without this an admin
  // of any tournament could record a score onto another tournament's match (IDOR).
  if (match.tournament_id !== input.tournamentId) return { error: t("match.notFound") };
  // Block re-recording a completed match: record_match_score ADDS to group standings,
  // so a second call double-counts. Editing a result must go through reset first
  // (the UI only shows ScoreForm on non-completed matches).
  if (match.status === "completed") return { error: t("match.alreadyCompleted") };

  // Competition-class matches must satisfy their class's match_format
  // (fixed_2 / best_of_3 / best_of_5). sports_day matches (class_id null) stay
  // on the lenient majority-wins path so existing workflows are untouched.
  let winner: "a" | "b" | "draw";
  if (match.class_id) {
    const { data: cls } = await sb
      .from("tournament_classes")
      .select("match_format")
      .eq("id", match.class_id)
      .single();
    const format = (cls?.match_format ?? "best_of_3") as MatchFormat;
    const result = resolveMatchResult(input.games, format);
    if (!result.ok) return { error: t(`match.resolve_${result.reason}`, { max: result.max ?? 0, winAt: result.winAt ?? 0 }) };
    winner = result.winner;
  } else {
    winner = gameWinner(input.games);
  }
  const totals = sumGameScores(input.games);

  // Any non-group round needs a decisive winner to advance the bracket. Stored
  // round_type is "group" | "knockout" today; `!== "group"` also covers any future
  // bracket-specific value (upper_*/grand_final) and a fixed_2 class KO that ties 1-1.
  if (match.round_type !== "group" && winner === "draw") {
    return { error: t("match.knockoutNoDrawAllowed") };
  }

  // Detect pair mode (pair_a_id/pair_b_id set) — applies to BOTH group and knockout
  const isPair = !!(match.pair_a_id || match.pair_b_id);
  const aId = isPair ? match.pair_a_id : match.team_a_id;
  const bId = isPair ? match.pair_b_id : match.team_b_id;
  const winnerId = winner === "a" ? aId : winner === "b" ? bId : null;
  const loserId = winner !== "draw" && winnerId ? (winnerId === aId ? bId : aId) : null;

  let gamesWonA = 0, gamesWonB = 0;
  for (const g of input.games) {
    if (g.a > g.b) gamesWonA++;
    else if (g.b > g.a) gamesWonB++;
  }

  const winnerSlot: "a" | "b" | null = winner === "draw" ? null : winner;

  const { error: rpcError } = await sb.rpc("record_match_score", {
    p_match_id: input.matchId,
    p_games: input.games,
    p_team_a_score: gamesWonA,
    p_team_b_score: gamesWonB,
    p_winner_slot: winnerSlot,
  });
  if (rpcError) return { error: t("match.recordScoreFailed") };

  // Update group_teams standings only for team-mode group matches (not pair)
  if (match.group_id && !match.pair_a_id) {
    await updateGroupTeamStandings(match.group_id, aId, bId, totals.a, totals.b, winner);
  }

  revalidatePath(`/tournaments/${input.tournamentId}`);
  await writeAuditLog({
    tournament_id: input.tournamentId,
    actor_id: session.profileId,
    actor_name: session.displayName,
    event_type: "score_updated",
    entity_type: "match",
    entity_id: input.matchId,
    description: `บันทึกผลแมตช์`,
  });
  // Fetch settings once — shared by the background notify IIFE and the auto_advance_next gate.
  const settings = await getTournamentSettings(input.tournamentId);

  // Build and send match result notification in background
  (async () => {
    try {
      const isPair = !!match.pair_a_id;
      let nameA = "—", nameB = "—", winnerName = "เสมอ";

      if (isPair) {
        const ids = [aId, bId].filter(Boolean) as string[];
        type PairRow = { id: string; display_pair_name: string | null; player1: { display_name: string } | null; player2: { display_name: string } | null };
        const { data } = await sb.from("pairs")
          .select("id, display_pair_name, player1:team_players!player_id_1(display_name), player2:team_players!player_id_2(display_name)")
          .in("id", ids);
        const pairMap = new Map((data as unknown as PairRow[] ?? []).map((p) => [
          p.id,
          (p.display_pair_name ?? [p.player1?.display_name, p.player2?.display_name].filter(Boolean).join(" / ")) || p.id.slice(0, 6),
        ]));
        nameA = (aId && pairMap.get(aId)) || "—";
        nameB = (bId && pairMap.get(bId)) || "—";
        winnerName = (winnerId && pairMap.get(winnerId)) || "เสมอ";
      } else {
        const ids = [aId, bId].filter(Boolean) as string[];
        const { data } = await sb.from("teams").select("id, name").in("id", ids);
        const teamMap = new Map((data ?? []).map((t) => [t.id, t.name]));
        nameA = (aId && teamMap.get(aId)) || "—";
        nameB = (bId && teamMap.get(bId)) || "—";
        winnerName = (winnerId && teamMap.get(winnerId)) || "เสมอ";
      }

      const gameDetail = input.games.map((g) => `${g.a}-${g.b}`).join(", ");
      await notifyTournamentEvent(
        input.tournamentId,
        "score",
        "notifyScore",
        { a: nameA, b: nameB, scoreA: gamesWonA, scoreB: gamesWonB, detail: gameDetail, winner: winnerName },
        settings,
      );
    } catch {}
  })();

  // Phase 11 — auto_advance_next: when enabled, promote the first pending match
  // in queue order to in_progress and inherit the just-finished court.
  // Writes a `match_started` audit row so the cooldown gate counts this promotion
  // and the user-facing queue revalidates. LINE notify is intentionally skipped
  // (separate code path — re-add later if needed).
  try {
    if (settings.auto_advance_next) {
      const inheritedCourt = match.court ?? null;
      // Skip pending matches with TBD slots (e.g. KO match awaiting prior round winner).
      // Pull a small queue window and pick the first fully-populated one — done in JS
      // because Supabase JS filter cannot express "(team_a AND team_b) OR (pair_a AND pair_b)".
      const { data: candidates } = await sb
        .from("matches")
        .select("id, match_number, team_a_id, team_b_id, pair_a_id, pair_b_id")
        .eq("tournament_id", input.tournamentId)
        .eq("status", "pending")
        .order("round_type", { ascending: true })
        .order("queue_position", { ascending: true, nullsFirst: false })
        .order("match_number")
        .limit(20);
      const populated = (candidates ?? []).filter((m) => {
        const isPairMatch = !!(m.pair_a_id || m.pair_b_id);
        return isPairMatch
          ? !!m.pair_a_id && !!m.pair_b_id
          : !!m.team_a_id && !!m.team_b_id;
      });
      let nextPending: (typeof populated)[number] | undefined;
      let promotedPlayerIds: string[] = [];
      let skippedDueToCheckin = 0;

      // Batch check-in resolution (V9 fix): pre-fetch pair compositions,
      // team rosters, and unchecked player IDs in 3 round-trips total, then
      // iterate `populated` in JS. Was 40 sequential awaits per score.
      const candPlayerIds = new Map<string, string[]>();
      if (settings.require_checkin && populated.length > 0) {
        try {
          const allPairIds = [...new Set(
            populated.flatMap((c) => [c.pair_a_id, c.pair_b_id].filter(Boolean) as string[])
          )];
          const allTeamIds = [...new Set(
            populated.flatMap((c) => [c.team_a_id, c.team_b_id].filter(Boolean) as string[])
          )];

          const pairPlayers = new Map<string, string[]>();
          if (allPairIds.length > 0) {
            const { data, error } = await sb
              .from("pairs")
              .select("id, player_id_1, player_id_2")
              .in("id", allPairIds);
            if (error) throw new Error(`auto-advance pairs: ${error.message}`);
            for (const p of data ?? []) {
              const ids: string[] = [];
              if (p.player_id_1) ids.push(p.player_id_1);
              if (p.player_id_2) ids.push(p.player_id_2);
              pairPlayers.set(p.id, ids);
            }
          }

          const teamRoster = new Map<string, string[]>();
          if (allTeamIds.length > 0) {
            const { data, error } = await sb
              .from("team_players")
              .select("id, team_id")
              .in("team_id", allTeamIds);
            if (error) throw new Error(`auto-advance team_players: ${error.message}`);
            for (const tp of data ?? []) {
              const arr = teamRoster.get(tp.team_id) ?? [];
              arr.push(tp.id);
              teamRoster.set(tp.team_id, arr);
            }
          }

          const involved = new Set<string>();
          // Track candidates whose pair/team roster lookup was partial (e.g.
          // a pair_a_id or team_a_id is present on the match but the batched
          // pairs/team_players fetch did not return rows for it — likely a
          // deleted/RLS-filtered entity). These candidates are SKIPPED rather
          // than partially probed, otherwise we'd silently bypass the
          // check-in gate for the missing side's players.
          const incompleteCandIds = new Set<string>();
          for (const c of populated) {
            const hasPair = !!(c.pair_a_id || c.pair_b_id);
            const ids = new Set<string>();
            let incomplete = false;
            if (hasPair) {
              if (c.pair_a_id) {
                const arr = pairPlayers.get(c.pair_a_id);
                if (!arr) incomplete = true;
                else arr.forEach((id) => ids.add(id));
              }
              if (c.pair_b_id) {
                const arr = pairPlayers.get(c.pair_b_id);
                if (!arr) incomplete = true;
                else arr.forEach((id) => ids.add(id));
              }
            } else {
              if (c.team_a_id) {
                const arr = teamRoster.get(c.team_a_id);
                if (arr === undefined) incomplete = true;
                else arr.forEach((id) => ids.add(id));
              }
              if (c.team_b_id) {
                const arr = teamRoster.get(c.team_b_id);
                if (arr === undefined) incomplete = true;
                else arr.forEach((id) => ids.add(id));
              }
            }
            if (incomplete) {
              incompleteCandIds.add(c.id);
              continue;
            }
            const arr = [...ids];
            candPlayerIds.set(c.id, arr);
            for (const id of arr) involved.add(id);
          }

          const uncheckedSet = new Set<string>();
          if (involved.size > 0) {
            const { data, error } = await sb
              .from("team_players")
              .select("id")
              .in("id", [...involved])
              .is("checked_in_at", null);
            if (error) throw new Error(`auto-advance unchecked: ${error.message}`);
            for (const tp of data ?? []) uncheckedSet.add(tp.id);
          }

          for (const cand of populated) {
            if (incompleteCandIds.has(cand.id)) { skippedDueToCheckin++; continue; }
            const ids = candPlayerIds.get(cand.id) ?? [];
            if (ids.length === 0) { skippedDueToCheckin++; continue; }
            const hasUnchecked = ids.some((id) => uncheckedSet.has(id));
            if (hasUnchecked) { skippedDueToCheckin++; continue; }
            nextPending = cand;
            promotedPlayerIds = ids;
            break;
          }
        } catch (err) {
          console.error("[auto_advance_next] batch checkin probe failed:", err);
          // Write an explicit audit row so the silent skip is traceable.
          await writeAuditLog({
            tournament_id: input.tournamentId,
            actor_id: session.profileId,
            actor_name: session.displayName,
            event_type: "auto_advance_skipped",
            entity_type: "tournament",
            entity_id: input.tournamentId,
            description: `ข้าม auto-advance: ตรวจสอบเช็คอินผิดพลาด`,
          });
          // Fall through with nextPending undefined; auto-advance skips safely.
        }
      } else {
        nextPending = populated[0];
      }
      if (nextPending?.id) {
        // Atomic promote: row lock + (optional) checkin re-verify + status update.
        const { data: rpcRes, error: rpcErr } = await sb.rpc("start_match_atomic", {
          p_match_id: nextPending.id,
          p_player_ids: settings.require_checkin ? promotedPlayerIds : [],
        });
        if (!rpcErr && rpcRes && typeof rpcRes === "object" && (rpcRes as { ok?: boolean }).ok === true) {
          let courtAssigned = false;
          // Inherit court via a follow-up update; RPC sets status+started_at only.
          // On 23505 court collision, roll the promote back so the queue head
          // doesn't get stuck `in_progress` with court=NULL.
          if (inheritedCourt) {
            const { error: courtErr } = await sb
              .from("matches")
              .update({ court: inheritedCourt })
              .eq("id", nextPending.id);
            if (courtErr) {
              if (courtErr.code === "23505") {
                // Roll back the promote — match returns to pending with no court.
                await sb
                  .from("matches")
                  .update({ status: "pending", started_at: null })
                  .eq("id", nextPending.id);
                await writeAuditLog({
                  tournament_id: input.tournamentId,
                  actor_id: session.profileId,
                  actor_name: session.displayName,
                  event_type: "auto_advance_skipped",
                  entity_type: "match",
                  entity_id: nextPending.id,
                  description: `ข้าม auto-advance #${nextPending.match_number}: สนาม ${inheritedCourt} ถูกใช้ระหว่างเริ่ม`,
                });
                await revalidateTournamentPaths(sb, input.tournamentId);
                return;
              }
              console.error("[auto_advance_next] court inherit failed:", courtErr.message);
            } else {
              courtAssigned = true;
            }
          }
          await revalidateTournamentPaths(sb, input.tournamentId);
          const skipSuffix = skippedDueToCheckin > 0 ? ` · ข้ามคิว ${skippedDueToCheckin} แมตช์` : "";
          const courtSuffix = courtAssigned && inheritedCourt ? ` (สนาม ${inheritedCourt})` : "";
          await writeAuditLog({
            tournament_id: input.tournamentId,
            actor_id: session.profileId,
            actor_name: session.displayName,
            event_type: "match_started",
            entity_type: "match",
            entity_id: nextPending.id,
            description: `เริ่มแมตช์ #${nextPending.match_number} (auto-advance)${courtSuffix}${skipSuffix}`,
          });

          // LINE notify — call players to court (mirrors startMatchAction's IIFE).
          (async () => {
            try {
              const isPair = !!(nextPending.pair_a_id || nextPending.pair_b_id);
              let nameA = "—";
              let nameB = "—";
              if (isPair) {
                const { data: pairs } = await sb
                  .from("pairs")
                  .select("id, display_pair_name, player1:team_players!player_id_1(display_name), player2:team_players!player_id_2(display_name)")
                  .in("id", [nextPending.pair_a_id, nextPending.pair_b_id].filter(Boolean) as string[]);
                const byId = new Map((pairs ?? []).map((p) => [p.id, p]));
                const formatPair = (p: { display_pair_name: string | null; player1: { display_name: string } | { display_name: string }[] | null; player2: { display_name: string } | { display_name: string }[] | null } | undefined) => {
                  if (!p) return "—";
                  if (p.display_pair_name) return p.display_pair_name;
                  const p1 = Array.isArray(p.player1) ? p.player1[0] : p.player1;
                  const p2 = Array.isArray(p.player2) ? p.player2[0] : p.player2;
                  return `${p1?.display_name ?? "?"} / ${p2?.display_name ?? "?"}`;
                };
                nameA = formatPair(nextPending.pair_a_id ? byId.get(nextPending.pair_a_id) : undefined);
                nameB = formatPair(nextPending.pair_b_id ? byId.get(nextPending.pair_b_id) : undefined);
              } else {
                const { data: teams } = await sb
                  .from("teams")
                  .select("id, name")
                  .in("id", [nextPending.team_a_id, nextPending.team_b_id].filter(Boolean) as string[]);
                const byId = new Map((teams ?? []).map((t) => [t.id, t.name]));
                nameA = nextPending.team_a_id ? byId.get(nextPending.team_a_id) ?? "—" : "—";
                nameB = nextPending.team_b_id ? byId.get(nextPending.team_b_id) ?? "—" : "—";
              }
              const courtTag = courtAssigned && inheritedCourt ? ` (สนาม ${inheritedCourt})` : "";
              await notifyTournamentEvent(
                input.tournamentId,
                "start",
                "notifyMatchCall",
                { num: nextPending.match_number, a: nameA, b: nameB, court: courtTag },
                settings,
              );
            } catch (notifyErr) {
              console.error("[auto_advance_next] line notify failed:", notifyErr);
            }
          })().catch(() => {});
        } else if (rpcErr) {
          if (rpcErr.code !== "23505") {
            console.error("[auto_advance_next] rpc failed:", rpcErr.message);
          }
        } else {
          const r = (rpcRes ?? {}) as { reason?: string };
          console.warn(`[auto_advance_next] rpc rejected: ${r.reason ?? "unknown"}`);
        }
      } else if (skippedDueToCheckin > 0) {
        await writeAuditLog({
          tournament_id: input.tournamentId,
          actor_id: session.profileId,
          actor_name: session.displayName,
          event_type: "auto_advance_skipped",
          entity_type: "tournament",
          entity_id: input.tournamentId,
          description: `ข้าม auto-advance: ทุกคิวรอเช็คอิน (${skippedDueToCheckin} แมตช์)`,
        });
      }
    }
  } catch (err) {
    console.error("[auto_advance_next] exception:", err);
  }

  return { ok: true };
}

export async function resetMatchScoreAction(matchId: string, tournamentId: string) {
  const session = await getSession();
  if (!session) return await loginRedirect();
  const t = await getTranslations("actions");
  if (!(await assertCanEdit(tournamentId, session.profileId))) return { error: t("match.noPermission") };

  const sb = await createAdminClient();
  const { data: match } = await sb.from("matches").select("*").eq("id", matchId).single();
  // Scope to the authorized tournament BEFORE touching standings — reverseGroupTeamStandings
  // below runs on match.group_id/team ids, so an out-of-tenant match would corrupt another
  // tournament's group_teams before the (already-scoped) RPC no-ops (IDOR / data-integrity).
  if (!match || match.tournament_id !== tournamentId) return { error: t("match.notFound") };
  if (match.status !== "completed") return { error: t("match.notCompleted") };

  if (match.group_id && !match.pair_a_id && match.team_a_id && match.team_b_id) {
    const totals = sumGameScores(match.games);
    const winner = gameWinner(match.games);
    await reverseGroupTeamStandings(match.group_id, match.team_a_id, match.team_b_id, totals.a, totals.b, winner);
  }

  const isPair = !!(match.pair_a_id || match.pair_b_id);
  const colPrefix = isPair ? "pair" : "team";

  // Phase 11 — allow_force_bracket_reset bypasses the "next match completed" guard
  const forceReset = (await getTournamentSettings(tournamentId)).allow_force_bracket_reset;

  // P1-B fix: all three UPDATEs (next_match slot clear, loser_next_match slot clear,
  // subject row reset) are now atomic inside the RPC with FOR UPDATE row locks.
  // The RPC also assigns queue_position = tail+1 atomically (fixes P1-A for reset path).
  const { error: rpcErr, data: rpcData } = await sb.rpc("reset_match_score", {
    p_match_id: matchId,
    p_tournament_id: tournamentId,
    p_col_prefix: colPrefix,
    p_allow_force_reset: forceReset,
  });
  if (rpcErr) {
    const msg = rpcErr.message ?? "";
    if (/next_match_already_completed/i.test(msg)) return { error: t("match.resetBlockedNextCompleted") };
    if (/loser_next_match_already_completed/i.test(msg)) return { error: t("match.resetBlockedLoserCompleted") };
    if (/match_not_found/i.test(msg)) return { error: t("match.notFound") };
    if (/match_not_completed/i.test(msg)) return { error: t("match.notCompleted") };
    console.error("[resetMatchScoreAction] rpc error:", rpcErr);
    return { error: t("match.resetFailed") };
  }
  void rpcData; // new queue_position returned but not needed by caller

  revalidatePath(`/tournaments/${tournamentId}`);
  await writeAuditLog({
    tournament_id: tournamentId,
    actor_id: session.profileId,
    actor_name: session.displayName,
    event_type: "score_reset",
    entity_type: "match",
    entity_id: matchId,
    description: `รีเซ็ตผลแมตช์`,
  });
  return { ok: true };
}

// ============ QUEUE / SCHEDULE ============

// Pure helper — no DB calls.
// Reorders pending match stubs by N-division priority.
//
// Bucket key: parseDivision(m.division) for group matches; same for KO (division is
// tagged at generation time). null division (no-split mode) → "null bucket" (appended last).
//
// Within each division bucket:
//   KO matches sort by bracket ('upper' < 'lower' < 'grand_final') then round_number then match_number.
//   Group matches sort by match_number.
//
// order:
//   sequential  — concat buckets in priority order; unlisted/null divs appended last.
//   interleaved — zip 1-at-a-time across priority-ordered buckets; residual appended.
//   chunked     — zip chunkSize-at-a-time across priority-ordered buckets; residual appended.
//
// Returns string[][] where each inner array is one isolation segment for the greedy rest-gap loop.
function orderByDivisionPriority(
  matches: {
    id: string;
    division: string | null;
    bracket: "upper" | "lower" | "grand_final" | null;
    round_type: "group" | "knockout";
    match_number: number | null;
  }[],
  order: import("@/lib/tournament/settings").TournamentSettings["queue_division_order"],
  priority: number[],
  chunkSize: number,
): string[][] {
  type MatchStub = typeof matches[number];

  const bracketRank = (b: string | null) =>
    b === "upper" ? 0 : b === "lower" ? 1 : b === "grand_final" ? 2 : 3;

  const sortWithin = (a: MatchStub, b: MatchStub) => {
    if (a.round_type === "knockout" && b.round_type === "knockout") {
      const br = bracketRank(a.bracket) - bracketRank(b.bracket);
      if (br !== 0) return br;
    }
    return (a.match_number ?? 0) - (b.match_number ?? 0);
  };

  // Group matches by division number; null gets its own bucket (key = null)
  const bucketMap = new Map<number | null, MatchStub[]>();
  for (const m of matches) {
    const key = parseDivision(m.division);
    if (!bucketMap.has(key)) bucketMap.set(key, []);
    bucketMap.get(key)!.push(m);
  }

  // Sort each bucket internally
  for (const arr of bucketMap.values()) arr.sort(sortWithin);

  // Build ordered list of buckets: priority-listed first, then remaining div keys asc, then null last
  const prioritySet = new Set(priority);
  const remainingDivs = Array.from(bucketMap.keys())
    .filter((k): k is number => k !== null && !prioritySet.has(k))
    .sort((a, b) => a - b);
  const orderedKeys: Array<number | null> = [
    ...priority.filter((d) => bucketMap.has(d)),
    ...remainingDivs,
    ...(bucketMap.has(null) ? [null] : []),
  ];

  const orderedBuckets = orderedKeys
    .map((k) => bucketMap.get(k) ?? [])
    .filter((b) => b.length > 0);

  const segments: string[][] = [];

  if (order === "sequential") {
    for (const bucket of orderedBuckets) {
      segments.push(bucket.map((m) => m.id));
    }
  } else {
    // interleaved (chunkSize=1) or chunked
    const effectiveChunk = order === "interleaved" ? 1 : chunkSize;
    const indices = orderedBuckets.map(() => 0);
    while (true) {
      let anyLeft = false;
      for (let i = 0; i < orderedBuckets.length; i++) {
        const bucket = orderedBuckets[i];
        const start = indices[i];
        if (start >= bucket.length) continue;
        anyLeft = true;
        const chunk = bucket.slice(start, start + effectiveChunk).map((m) => m.id);
        indices[i] += effectiveChunk;
        if (chunk.length > 0) segments.push(chunk);
      }
      if (!anyLeft) break;
    }
  }

  return segments;
}

async function revalidateTournamentPaths(sb: Awaited<ReturnType<typeof createAdminClient>>, tournamentId: string) {
  revalidatePath(`/tournaments/${tournamentId}`);
  const { data, error } = await sb
    .from("tournaments")
    .select("share_token")
    .eq("id", tournamentId)
    .maybeSingle();
  if (error) {
    console.error("revalidateTournamentPaths share_token lookup:", error);
    return;
  }
  if (data?.share_token) {
    // 'layout' invalidates the entire /t/[token] subtree — covers /tv,
    // /bracket, /court/[n], and /stats/{pair|player|team|division}/[id].
    revalidatePath(`/t/${data.share_token}`, "layout");
  }
}

export async function reorderMatchQueueAction(
  tournamentId: string,
  orderedMatchIds: string[],
) {
  const session = await getSession();
  if (!session) return await loginRedirect();
  const t = await getTranslations("actions");
  if (!(await assertCanEdit(tournamentId, session.profileId))) return { error: t("match.noPermission") };

  const sb = await createAdminClient();

  // Filter to pending-only — in_progress/completed must never be swapped.
  const { data: pendingRows } = await sb
    .from("matches")
    .select("id")
    .eq("tournament_id", tournamentId)
    .eq("status", "pending")
    .in("id", orderedMatchIds);
  const pendingIdSet = new Set((pendingRows ?? []).map((r) => r.id));
  const pendingOrdered = orderedMatchIds.filter((id) => pendingIdSet.has(id));
  if (pendingOrdered.length === 0) return { ok: true };

  const { error: rpcErr } = await sb.rpc("swap_pending_match_numbers", {
    p_tournament_id: tournamentId,
    p_ordered_ids: pendingOrdered,
  });
  if (rpcErr) {
    const msg = rpcErr.message ?? "";
    if (/not pending matches/i.test(msg)) {
      return { error: t("match.reorderNonPendingFound") };
    }
    return { error: t("match.reorderFailed") };
  }

  await revalidateTournamentPaths(sb, tournamentId);
  await writeAuditLog({
    tournament_id: tournamentId,
    actor_id: session.profileId,
    actor_name: session.displayName,
    event_type: "queue_reordered",
    entity_type: "tournament",
    entity_id: tournamentId,
    description: `จัดลำดับคิว ${pendingOrdered.length} แมตช์`,
  });
  return { ok: true };
}

export async function autoRotateQueueAction(tournamentId: string, restGap?: number) {
  const session = await getSession();
  if (!session) return await loginRedirect();
  const t = await getTranslations("actions");
  if (!(await assertCanEdit(tournamentId, session.profileId))) return { error: t("match.noPermission") };

  const sb = await createAdminClient();

  // Phase 11 — per-tournament settings drive restGap (when caller omits) + bracket pref
  const settingsForRotate = await getTournamentSettings(tournamentId);
  if (restGap === undefined) {
    restGap = settingsForRotate.auto_rotate_rest_gap;
  }

  // Pending matches in current queue order. We also need `division` to honor the
  // division-priority bucketing for group rounds.
  const { data: pending, error } = await sb
    .from("matches")
    .select("id, queue_position, match_number, team_a_id, team_b_id, pair_a_id, pair_b_id, bracket, division, round_type")
    .eq("tournament_id", tournamentId)
    .eq("status", "pending")
    .order("round_type", { ascending: true })
    .order("queue_position", { ascending: true, nullsFirst: false })
    .order("match_number");
  if (error) return { error: t("match.readMatchListFailed") };
  if (!pending || pending.length < 2) return { ok: true, rotated: 0 };

  // Snapshot current queue order BEFORE applying bracket preference so the
  // post-greedy `changed` check detects sort-only reshuffles (no player swap)
  // and still writes back.
  const originalIds = pending.map((m) => m.id);

  // Bucket pending matches by division priority using the pure helper.
  // The helper returns string[][] where each inner array is one isolation segment.
  const divPriority = settingsForRotate.queue_division_priority.length > 0
    ? settingsForRotate.queue_division_priority
    : Array.from(new Set(pending.map((m) => parseDivision(m.division)).filter((d): d is number => d !== null))).sort((a, b) => a - b);
  const prefOrderedIds = orderByDivisionPriority(
    pending.map((m) => ({
      id: m.id,
      division: m.division,
      bracket: m.bracket as "upper" | "lower" | "grand_final" | null,
      round_type: m.round_type as "group" | "knockout",
      match_number: m.match_number,
    })),
    settingsForRotate.queue_division_order,
    divPriority,
    settingsForRotate.queue_chunk_size,
  );
  const pendingById = new Map(pending.map((m) => [m.id, m]));

  // In-progress matches — players currently on court count as "just played"
  const { data: inProgress } = await sb
    .from("matches")
    .select("team_a_id, team_b_id, pair_a_id, pair_b_id")
    .eq("tournament_id", tournamentId)
    .eq("status", "in_progress");

  // Build player_id sets per match
  type SlotRow = { team_a_id: string | null; team_b_id: string | null; pair_a_id: string | null; pair_b_id: string | null };
  const allRows: SlotRow[] = [...(pending as SlotRow[]), ...((inProgress as SlotRow[]) ?? [])];
  const teamIds = new Set<string>();
  const pairIds = new Set<string>();
  for (const m of allRows) {
    if (m.team_a_id) teamIds.add(m.team_a_id);
    if (m.team_b_id) teamIds.add(m.team_b_id);
    if (m.pair_a_id) pairIds.add(m.pair_a_id);
    if (m.pair_b_id) pairIds.add(m.pair_b_id);
  }

  const teamPlayersByTeam = new Map<string, string[]>();
  if (teamIds.size > 0) {
    const { data: rows } = await sb
      .from("team_players")
      .select("team_id, id")
      .in("team_id", Array.from(teamIds));
    for (const r of rows ?? []) {
      const arr = teamPlayersByTeam.get(r.team_id) ?? [];
      arr.push(r.id);
      teamPlayersByTeam.set(r.team_id, arr);
    }
  }

  const pairPlayers = new Map<string, string[]>();
  if (pairIds.size > 0) {
    const { data: rows } = await sb
      .from("pairs")
      .select("id, player_id_1, player_id_2")
      .in("id", Array.from(pairIds));
    for (const r of rows ?? []) {
      pairPlayers.set(r.id, [r.player_id_1, r.player_id_2].filter(Boolean) as string[]);
    }
  }

  const playersOf = (m: SlotRow): string[] => {
    const out: string[] = [];
    if (m.team_a_id) out.push(...(teamPlayersByTeam.get(m.team_a_id) ?? []));
    if (m.team_b_id) out.push(...(teamPlayersByTeam.get(m.team_b_id) ?? []));
    if (m.pair_a_id) out.push(...(pairPlayers.get(m.pair_a_id) ?? []));
    if (m.pair_b_id) out.push(...(pairPlayers.get(m.pair_b_id) ?? []));
    return out;
  };

  // Seed "recent" with in-progress players once at the start of each bucket so
  // they are rested before any pending match in that bucket is considered.
  const inProgressPlayers = new Set<string>();
  for (const m of (inProgress as SlotRow[]) ?? []) {
    for (const p of playersOf(m)) inProgressPlayers.add(p);
  }

  // Greedy rest-gap pass — iterate per bucket to preserve strict bracket isolation.
  // The helper returns string[][] where each inner array is one isolation segment.
  // Within each bucket the greedy may reorder matches to satisfy restGap; it cannot
  // push a match across a bucket boundary. The `recent` window carries forward
  // across bucket boundaries (natural — restGap is a sliding window over result).
  const result: typeof pending = [];
  for (const bucketIds of prefOrderedIds) {
    const bucketMatches = bucketIds.map((id) => pendingById.get(id)!).filter(Boolean);
    const remaining = [...bucketMatches];
    while (remaining.length > 0) {
      // Seed recent: in-progress players at position 0 of result overall; then
      // the trailing restGap window from all matches placed so far (crosses buckets).
      const recent = new Set<string>(result.length === 0 ? inProgressPlayers : []);
      for (const m of result.slice(-restGap)) {
        for (const p of playersOf(m)) recent.add(p);
      }
      let pickIdx = -1;
      for (let i = 0; i < remaining.length; i++) {
        const ps = playersOf(remaining[i]);
        const hasConflict = ps.some((p) => recent.has(p));
        if (!hasConflict) { pickIdx = i; break; }
      }
      if (pickIdx < 0) pickIdx = 0;
      result.push(remaining[pickIdx]);
      remaining.splice(pickIdx, 1);
    }
  }

  // Compare against ORIGINAL (pre-sort) queue order so bracket-pref reshuffles
  // are detected even when greedy doesn't swap anything.
  let changed = 0;
  for (let i = 0; i < result.length; i++) {
    if (result[i].id !== originalIds[i]) changed += 1;
  }
  if (changed === 0) return { ok: true, rotated: 0 };

  // Atomic re-assignment via swap_pending_match_numbers RPC.
  // Re-fetch pending ids to guard against any status change during compute.
  const computedIds = result.map((m) => m.id);
  const { data: stillPendingRows } = await sb
    .from("matches")
    .select("id")
    .eq("tournament_id", tournamentId)
    .eq("status", "pending")
    .in("id", computedIds);
  const stillPendingSet = new Set((stillPendingRows ?? []).map((r) => r.id));
  const orderedIds = computedIds.filter((id) => stillPendingSet.has(id));
  if (orderedIds.length === 0) return { ok: true, rotated: 0 };

  const { error: rpcErr } = await sb.rpc("swap_pending_match_numbers", {
    p_tournament_id: tournamentId,
    p_ordered_ids: orderedIds,
  });
  if (rpcErr) return { error: t("match.reorderFailed") };

  await revalidateTournamentPaths(sb, tournamentId);
  await writeAuditLog({
    tournament_id: tournamentId,
    actor_id: session.profileId,
    actor_name: session.displayName,
    event_type: "queue_auto_rotated",
    entity_type: "tournament",
    entity_id: tournamentId,
    description: `จัดคิวอัตโนมัติ — สลับ ${changed} แมตช์`,
  });
  return { ok: true, rotated: changed };
}

const COURT_NAME_MAX = 40;

// Policy: when court_strict=true (default), assigning an occupied court is blocked here.
// when court_strict=false, the pre-check is skipped — the court can be assigned freely,
// but the Start button is disabled client-side and the DB partial UNIQUE index
// `uniq_matches_inprogress_court` still prevents two in_progress rows on the same court.
export async function setMatchCourtAction(input: {
  matchId: string;
  tournamentId: string;
  court: string | null;
}) {
  const session = await getSession();
  if (!session) return await loginRedirect();
  const t = await getTranslations("actions");
  if (!(await assertCanEdit(input.tournamentId, session.profileId))) return { error: t("match.noPermission") };

  const sb = await createAdminClient();
  const rawCourt = input.court?.trim() ?? "";
  const court = rawCourt.length > 0 ? rawCourt.slice(0, COURT_NAME_MAX) : null;

  const settings = await getTournamentSettings(input.tournamentId);

  if (court && settings.court_strict) {
    const { data: occupier } = await sb
      .from("matches")
      .select("id, match_number")
      .eq("tournament_id", input.tournamentId)
      .eq("status", "in_progress")
      .eq("court", court)
      .neq("id", input.matchId)
      .maybeSingle();
    if (occupier) {
      return { error: t("match.courtOccupied", { court, n: occupier.match_number }) };
    }
  }

  const { error } = await sb
    .from("matches")
    .update({ court })
    .eq("id", input.matchId)
    .eq("tournament_id", input.tournamentId);
  if (error) return { error: t("match.saveCourtFailed") };

  await revalidateTournamentPaths(sb, input.tournamentId);
  await writeAuditLog({
    tournament_id: input.tournamentId,
    actor_id: session.profileId,
    actor_name: session.displayName,
    event_type: "match_court_set",
    entity_type: "match",
    entity_id: input.matchId,
    description: court ? `ตั้งสนาม "${court}"` : "ล้างสนาม",
  });
  return { ok: true };
}

export async function startMatchAction(matchId: string, tournamentId: string) {
  const session = await getSession();
  if (!session) return await loginRedirect();
  const t = await getTranslations("actions");
  if (!(await assertCanEdit(tournamentId, session.profileId))) return { error: t("match.noPermission") };

  const sb = await createAdminClient();
  const { data: match } = await sb
    .from("matches")
    .select("id, status, court, match_number, team_a_id, team_b_id, pair_a_id, pair_b_id, round_type, round_number, division, class_id")
    .eq("id", matchId)
    .eq("tournament_id", tournamentId)
    .maybeSingle();
  if (!match) return { error: t("match.notFound") };
  if (match.status === "completed") return { error: t("match.alreadyFinished") };
  if (match.status === "in_progress") return { error: t("match.alreadyInProgress") };

  // Knockout R1 cannot start until all group matches of the same scope are completed.
  // Competition mode: scope by class_id (class matches carry division=NULL, so each
  // class's KO gates only on its own group matches). Sports_day: scope by division
  // (or ALL group matches for team mode / undivided pair mode where division IS NULL).
  if (match.round_type === "knockout" && match.round_number === 1) {
    let groupQuery = sb
      .from("matches")
      .select("id", { count: "exact", head: true })
      .eq("tournament_id", tournamentId)
      .eq("round_type", "group")
      .neq("status", "completed");
    if (match.class_id) {
      groupQuery = groupQuery.eq("class_id", match.class_id);
    } else if (match.division) {
      groupQuery = groupQuery.eq("division", match.division);
    }
    const { count: pendingGroups } = await groupQuery;
    if ((pendingGroups ?? 0) > 0) {
      const divNum = parseDivision(match.division);
      const tTour = await getTranslations("tournament");
      const label =
        divNum !== null
          ? `แมตช์รอบกลุ่ม${tTour("division", { n: divNum })}`
          : "แมตช์รอบกลุ่ม";
      return { error: t("match.waitGroupMatchesFirst", { label }) };
    }
  }

  // Phase 11 — cooldown gate: read from matches.started_at (decoupled from audit_log_enabled).
  // Backfill on migration ensures pre-existing in_progress rows count.
  const settings = await getTournamentSettings(tournamentId);

  // require_court_to_start gate: reject if flag is on and no court assigned.
  if (settings.require_court_to_start && !match.court) {
    return { error: t("match.requireCourtBeforeStart") };
  }

  // require_checkin pre-gate: only differentiate the TBD-slot and
  // empty-roster cases here (the RPC can't surface those — it sees
  // a uuid[] and treats empty as "no check required"). The actual
  // unchecked-count is verified atomically by the RPC under a row
  // lock and returned via reason='unchecked'.
  let checkinPlayerIds: string[] = [];
  if (settings.require_checkin) {
    try {
      const collected = await collectMatchPlayerIds(sb, match);
      if (!collected.ok) {
        if (collected.reason === "tbd") return { error: t("match.checkinTbdSlots") };
        return { error: t("match.checkinNoPlayers") };
      }
      checkinPlayerIds = collected.ids;
    } catch (err) {
      console.error("[require_checkin gate]", err);
      return { error: t("match.checkinVerifyFailed") };
    }
  }

  if (settings.match_cooldown_minutes > 0) {
    const { data: lastStarted } = await sb
      .from("matches")
      .select("started_at")
      .eq("tournament_id", tournamentId)
      .not("started_at", "is", null)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (lastStarted?.started_at) {
      const elapsedMs = Date.now() - new Date(lastStarted.started_at).getTime();
      const requiredMs = settings.match_cooldown_minutes * 60_000;
      if (elapsedMs < requiredMs) {
        const remainSec = Math.ceil((requiredMs - elapsedMs) / 1000);
        const remainMin = Math.ceil(remainSec / 60);
        return { error: t("match.cooldownWait", { n: remainMin, cooldown: settings.match_cooldown_minutes }) };
      }
    }
  }

  // Court occupancy: best-effort pre-check (UX). The DB partial unique index
  // `uniq_matches_inprogress_court` is the source of truth — TOCTOU between
  // two concurrent starts is caught by the index below.
  if (match.court) {
    const { data: occupier } = await sb
      .from("matches")
      .select("id, match_number")
      .eq("tournament_id", tournamentId)
      .eq("status", "in_progress")
      .eq("court", match.court)
      .neq("id", matchId)
      .maybeSingle();
    if (occupier) {
      return { error: t("match.courtOccupied", { court: match.court, n: occupier.match_number }) };
    }
  }

  // Atomic transition: row-lock match + re-verify checkin under the lock +
  // UPDATE pending -> in_progress. Closes TOCTOU on the require_checkin gate.
  const { data: rpcRes, error } = await sb.rpc("start_match_atomic", {
    p_match_id: matchId,
    p_player_ids: settings.require_checkin ? checkinPlayerIds : [],
  });
  if (!error && rpcRes && typeof rpcRes === "object" && (rpcRes as { ok?: boolean }).ok === false) {
    const r = rpcRes as { reason?: string; count?: number };
    if (r.reason === "unchecked") return { error: t("match.uncheckedPlayers", { n: r.count ?? 0 }) };
    if (r.reason === "in_progress") return { error: t("match.alreadyInProgress") };
    if (r.reason === "completed") return { error: t("match.alreadyFinished") };
    if (r.reason === "status_changed") return { error: t("match.statusChangedRetry") };
    if (r.reason === "not_found") return { error: t("match.notFound") };
    return { error: t("match.startFailed") };
  }
  if (error) {
    if (error.code === "23505") {
      return { error: t("match.courtConflictRetry", { court: match.court ?? "—" }) };
    }
    return { error: t("match.updateStatusFailed") };
  }

  await revalidateTournamentPaths(sb, tournamentId);

  // LINE notify — call players to court
  (async () => {
    try {
      const isPair = !!(match.pair_a_id || match.pair_b_id);
      let nameA = "—";
      let nameB = "—";
      if (isPair) {
        const { data: pairs } = await sb
          .from("pairs")
          .select("id, display_pair_name, player1:team_players!player_id_1(display_name), player2:team_players!player_id_2(display_name)")
          .in("id", [match.pair_a_id, match.pair_b_id].filter(Boolean) as string[]);
        const byId = new Map((pairs ?? []).map((p) => [p.id, p]));
        const formatPair = (p: { display_pair_name: string | null; player1: { display_name: string } | { display_name: string }[] | null; player2: { display_name: string } | { display_name: string }[] | null } | undefined) => {
          if (!p) return "—";
          if (p.display_pair_name) return p.display_pair_name;
          const p1 = Array.isArray(p.player1) ? p.player1[0] : p.player1;
          const p2 = Array.isArray(p.player2) ? p.player2[0] : p.player2;
          return `${p1?.display_name ?? "?"} / ${p2?.display_name ?? "?"}`;
        };
        nameA = formatPair(match.pair_a_id ? byId.get(match.pair_a_id) : undefined);
        nameB = formatPair(match.pair_b_id ? byId.get(match.pair_b_id) : undefined);
      } else {
        const { data: teams } = await sb
          .from("teams")
          .select("id, name")
          .in("id", [match.team_a_id, match.team_b_id].filter(Boolean) as string[]);
        const byId = new Map((teams ?? []).map((t) => [t.id, t.name]));
        nameA = match.team_a_id ? byId.get(match.team_a_id) ?? "—" : "—";
        nameB = match.team_b_id ? byId.get(match.team_b_id) ?? "—" : "—";
      }
      const courtPart = match.court ? ` (สนาม ${match.court})` : "";
      await notifyTournamentEvent(
        tournamentId,
        "start",
        "notifyMatchCall",
        { num: match.match_number, a: nameA, b: nameB, court: courtPart },
        settings,
      );
    } catch {}
  })();

  await writeAuditLog({
    tournament_id: tournamentId,
    actor_id: session.profileId,
    actor_name: session.displayName,
    event_type: "match_started",
    entity_type: "match",
    entity_id: matchId,
    description: `เริ่มแมตช์ #${match.match_number}${match.court ? ` (สนาม ${match.court})` : ""}`,
  });

  // Pending match_numbers keep their values (gap at the started match).
  // Renumber only fires on manual drag or auto-rotate in the queue tab.

  return { ok: true };
}

export async function cancelMatchAction(matchId: string, tournamentId: string) {
  const session = await getSession();
  if (!session) return await loginRedirect();
  const t = await getTranslations("actions");
  if (!(await assertCanEdit(tournamentId, session.profileId))) return { error: t("match.noPermission") };

  const sb = await createAdminClient();
  const { data: match } = await sb
    .from("matches")
    .select("id, status, match_number, court")
    .eq("id", matchId)
    .eq("tournament_id", tournamentId)
    .maybeSingle();
  if (!match) return { error: t("match.notFound") };
  if (match.status !== "in_progress") return { error: t("match.notInProgress") };

  // Atomic flip + tail-position assignment via RPC (prevents duplicate
  // queue_position when cancel and createManual run concurrently).
  const { error } = await sb.rpc("cancel_match_to_queue_tail", {
    p_match_id: matchId,
    p_tournament_id: tournamentId,
  });
  if (error) {
    console.error("[cancelMatchAction]", error);
    return { error: t("match.cancelFailed") };
  }

  await revalidateTournamentPaths(sb, tournamentId);

  await writeAuditLog({
    tournament_id: tournamentId,
    actor_id: session.profileId,
    actor_name: session.displayName,
    event_type: "match_cancelled",
    entity_type: "match",
    entity_id: matchId,
    description: `ยกเลิกการแข่งแมตช์ #${match.match_number}${match.court ? ` (สนาม ${match.court})` : ""}`,
  });

  return { ok: true };
}

// ============ Internal helpers ============

// Apply (sign=+1) or reverse (sign=-1) a match result onto the two teams'
// `group_teams` rows via the `apply_group_team_delta` RPC, which does an atomic
// `col = GREATEST(0, col + delta)` per row. This closes the lost-update race the
// old SELECT-then-UPDATE-with-JS-computed-value had: two concurrent score writes
// on matches in the SAME group both read the same baseline and one overwrote the
// other. GREATEST(0,…) floors both directions (matches the old Math.max(0,…) on
// reversal); on the forward path the deltas are non-negative so the floor is a no-op.
async function applyGroupTeamStandings(
  groupId: string,
  aId: string | null,
  bId: string | null,
  scoreA: number,
  scoreB: number,
  winner: "a" | "b" | "draw",
  sign: 1 | -1
) {
  if (!aId || !bId) return;
  const sb = await createAdminClient();
  await Promise.all([aId, bId].map(async (teamId) => {
    const isA = teamId === aId;
    const myScore = isA ? scoreA : scoreB;
    const oppScore = isA ? scoreB : scoreA;
    const won = (isA && winner === "a") || (!isA && winner === "b");
    const drew = winner === "draw";
    const lost = !won && !drew;
    const { error } = await sb.rpc("apply_group_team_delta", {
      p_group_id: groupId,
      p_team_id: teamId,
      p_dwins: sign * (won ? 1 : 0),
      p_ddraws: sign * (drew ? 1 : 0),
      p_dlosses: sign * (lost ? 1 : 0),
      p_dpf: sign * myScore,
      p_dpa: sign * oppScore,
    });
    if (error) console.error("apply_group_team_delta failed", error);
  }));
}

async function updateGroupTeamStandings(
  groupId: string,
  aId: string | null,
  bId: string | null,
  scoreA: number,
  scoreB: number,
  winner: "a" | "b" | "draw"
) {
  await applyGroupTeamStandings(groupId, aId, bId, scoreA, scoreB, winner, 1);
}

async function reverseGroupTeamStandings(
  groupId: string,
  aId: string,
  bId: string,
  scoreA: number,
  scoreB: number,
  winner: "a" | "b" | "draw"
) {
  await applyGroupTeamStandings(groupId, aId, bId, scoreA, scoreB, winner, -1);
}
