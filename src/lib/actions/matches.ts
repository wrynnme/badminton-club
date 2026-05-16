"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/auth/session";
import { generateAllPairMatches } from "@/lib/tournament/scheduling";
import { gameWinner, sumGameScores, computeStandings } from "@/lib/tournament/scoring";
import { buildBracket, buildDoubleBracket, nextPowerOf2 } from "@/lib/tournament/bracket";
import type { BracketEntry, BracketMatchDef } from "@/lib/tournament/bracket";
import type { Game, Match } from "@/lib/types";
import { assertCanEdit } from "@/lib/tournament/permissions";
import { writeAuditLog } from "@/lib/tournament/audit";
import { notifyTournamentAdmins } from "@/lib/notification/line";

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
  if (!(await assertCanEdit(tournamentId, session.profileId))) return { error: "ไม่มีสิทธิ์" };

  const sb = await createAdminClient();

  const { data: tournament } = await sb
    .from("tournaments")
    .select("match_unit")
    .eq("id", tournamentId)
    .maybeSingle();
  if (!tournament) return { error: "ไม่พบทัวร์นาเมนต์" };
  if (tournament.match_unit !== "team") return { error: "โหมดคู่ไม่ใช้กลุ่ม" };

  const { data: teams } = await sb.from("teams").select("id").eq("tournament_id", tournamentId);
  if (!teams?.length) return { error: "ยังไม่มีทีม" };

  const shuffled = [...teams].sort(() => Math.random() - 0.5);
  const names = "ABCDEFGHIJKLMNOP".split("").slice(0, groupCount).map((n) => `กลุ่ม ${n}`);
  const assignments = shuffled.map((team, i) => ({ group_index: i % groupCount, team_id: team.id }));

  const { error: rpcError } = await sb.rpc("regenerate_tournament_groups", {
    p_tournament_id: tournamentId,
    p_group_names: names,
    p_assignments: assignments,
  });
  if (rpcError) return { error: "สร้างกลุ่มไม่สำเร็จ กรุณาลองใหม่" };

  revalidatePath(`/tournaments/${tournamentId}`);
  await writeAuditLog({
    tournament_id: tournamentId,
    actor_id: session.profileId,
    actor_name: session.displayName,
    event_type: "bracket_generated",
    entity_type: "tournament",
    entity_id: tournamentId,
    description: `สร้างกลุ่ม ${groupCount} กลุ่ม`,
  });
  return { ok: true };
}

export async function generateGroupMatchesAction(tournamentId: string) {
  const session = await getSession();
  if (!session) return await loginRedirect();
  if (!(await assertCanEdit(tournamentId, session.profileId))) return { error: "ไม่มีสิทธิ์" };

  const sb = await createAdminClient();

  const { data: groups } = await sb
    .from("groups")
    .select("id, group_teams(team_id)")
    .eq("tournament_id", tournamentId);
  if (!groups?.length) return { error: "ยังไม่มีกลุ่ม" };

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
  if (rpcError) return { error: "สร้างแมตช์กลุ่มไม่สำเร็จ" };

  revalidatePath(`/tournaments/${tournamentId}`);
  await writeAuditLog({
    tournament_id: tournamentId,
    actor_id: session.profileId,
    actor_name: session.displayName,
    event_type: "bracket_generated",
    entity_type: "tournament",
    entity_id: tournamentId,
    description: `สร้างแมตช์กลุ่ม ${inserts.length} นัด`,
  });
  return { ok: true, count: inserts.length };
}

// ============ PAIR MODE ============

function levelToNum(level: string | null | undefined): number {
  if (!level) return 0;
  const n = parseFloat(level);
  return isNaN(n) ? 0 : n;
}

export async function generatePairMatchesAction(tournamentId: string) {
  const session = await getSession();
  if (!session) return await loginRedirect();
  if (!(await assertCanEdit(tournamentId, session.profileId))) return { error: "ไม่มีสิทธิ์" };

  const sb = await createAdminClient();

  // Fetch tournament threshold + pairs
  const { data: tournament } = await sb.from("tournaments").select("pair_division_threshold").eq("id", tournamentId).single();
  const threshold = tournament?.pair_division_threshold ?? null;

  const { data: teams } = await sb
    .from("teams")
    .select("id, pairs(id, player_id_1, player_id_2, pair_level)")
    .eq("tournament_id", tournamentId);
  if (!teams?.length) return { error: "ยังไม่มีทีม" };

  type RawPair = { id: string; player_id_1: string | null; player_id_2: string | null; pair_level: string | null };
  type RawTeam = { id: string; pairs: RawPair[] };

  function pairDivision(p: RawPair): "upper" | "lower" | null {
    if (threshold === null) return null;
    return levelToNum(p.pair_level) > threshold ? "upper" : "lower";
  }

  const allTeamPairs = (teams as unknown as RawTeam[]).map((t) => ({
    teamId: t.id,
    pairs: t.pairs.filter((p) => p.player_id_1 && p.player_id_2),
  }));

  let allMatchInserts: { round_number: number; match_number: number; team_a_id: string; team_b_id: string; pair_a_id: string; pair_b_id: string; division?: "upper" | "lower" }[];
  let upperCount = 0, lowerCount = 0;

  if (threshold === null) {
    // No division — all pairs compete together
    const teamPairs = allTeamPairs
      .map((t) => ({ teamId: t.teamId, pairIds: t.pairs.map((p) => p.id) }))
      .filter((tp) => tp.pairIds.length > 0);
    if (teamPairs.length < 2) return { error: "ต้องมีอย่างน้อย 2 ทีมที่มีคู่" };
    const all = generateAllPairMatches(teamPairs);
    allMatchInserts = all.map((m, i) => ({
      round_number: 1, match_number: i + 1,
      team_a_id: m.teamAId, team_b_id: m.teamBId, pair_a_id: m.pairAId, pair_b_id: m.pairBId,
    }));
  } else {
    const buildTierPairs = (div: "upper" | "lower") =>
      allTeamPairs
        .map((t) => ({ teamId: t.teamId, pairIds: t.pairs.filter((p) => pairDivision(p) === div).map((p) => p.id) }))
        .filter((tp) => tp.pairIds.length > 0);

    const upperMatches = buildTierPairs("upper").length >= 2 ? generateAllPairMatches(buildTierPairs("upper")) : [];
    const lowerMatches = buildTierPairs("lower").length >= 2 ? generateAllPairMatches(buildTierPairs("lower")) : [];
    if (!upperMatches.length && !lowerMatches.length) return { error: "ต้องมีอย่างน้อย 2 ทีมที่มีคู่" };

    upperCount = upperMatches.length;
    lowerCount = lowerMatches.length;
    let matchNum = 1;
    allMatchInserts = [
      ...upperMatches.map((m) => ({ round_number: 1, match_number: matchNum++, team_a_id: m.teamAId, team_b_id: m.teamBId, pair_a_id: m.pairAId, pair_b_id: m.pairBId, division: "upper" as const })),
      ...lowerMatches.map((m) => ({ round_number: 1, match_number: matchNum++, team_a_id: m.teamAId, team_b_id: m.teamBId, pair_a_id: m.pairAId, pair_b_id: m.pairBId, division: "lower" as const })),
    ];
  }

  const { error: rpcError } = await sb.rpc("replace_tournament_matches", {
    p_tournament_id: tournamentId,
    p_round_type: "group",
    p_matches: allMatchInserts,
  });
  if (rpcError) return { error: "สร้างแมตช์คู่ไม่สำเร็จ" };

  revalidatePath(`/tournaments/${tournamentId}`);
  await writeAuditLog({
    tournament_id: tournamentId,
    actor_id: session.profileId,
    actor_name: session.displayName,
    event_type: "bracket_generated",
    entity_type: "tournament",
    entity_id: tournamentId,
    description: `สร้างแมตช์คู่ ${allMatchInserts.length} นัด`,
  });
  return { ok: true, count: allMatchInserts.length, upper: upperCount, lower: lowerCount };
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

async function insertAndResolveByes(
  sb: Awaited<ReturnType<typeof createAdminClient>>,
  tournamentId: string,
  allMatches: BracketMatchDef[],
  isPair = false,
) {
  const colA = isPair ? "pair_a_id" : "team_a_id";
  const colB = isPair ? "pair_b_id" : "team_b_id";

  const inserts = allMatches.map((m) => ({
    id: m.id,
    round_number: m.roundNumber,
    match_number: m.matchNumber,
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
  if (error) return { error: "สร้างสายน็อกเอาต์ไม่สำเร็จ" };

  // Auto-complete BYE matches and advance winners; do 2 passes for cascading lower bracket BYEs
  for (let pass = 0; pass < 2; pass++) {
    const byeMatches = allMatches.filter((m) => m.isBye);
    const lowerByeCandidates = allMatches.filter((m) => m.bracket === "lower" || m.bracket === "grand_final");

    // Upper BYEs — advance winner only; BYE has no real loser, so loserNextMatch slot is left null
    if (pass === 0) {
      for (const m of byeMatches) {
        const winner = m.teamAId ?? m.teamBId;
        await sb.from("matches").update({ status: "completed", winner_id: winner }).eq("id", m.id);
        if (m.nextMatchId && m.nextMatchSlot && winner) {
          const slot = m.nextMatchSlot === "a" ? colA : colB;
          await sb.from("matches").update({ [slot]: winner }).eq("id", m.nextMatchId);
        }
      }
    }

    // Lower bracket single-team BYEs (from null upper losers)
    if (lowerByeCandidates.length > 0) {
      const { data: lowerCurrent } = await sb
        .from("matches")
        .select("id, team_a_id, team_b_id, pair_a_id, pair_b_id, next_match_id, next_match_slot, status")
        .eq("tournament_id", tournamentId)
        .eq("round_type", "knockout")
        .in("id", lowerByeCandidates.map((m) => m.id))
        .eq("status", "pending");

      for (const m of lowerCurrent ?? []) {
        const aId = (isPair ? m.pair_a_id : m.team_a_id) as string | null;
        const bId = (isPair ? m.pair_b_id : m.team_b_id) as string | null;
        if ((aId === null) === (bId === null)) continue; // both null or both real
        const winner = aId ?? bId;
        await sb.from("matches").update({ status: "completed", winner_id: winner }).eq("id", m.id);
        if (m.next_match_id && m.next_match_slot && winner) {
          const slot = m.next_match_slot === "a" ? colA : colB;
          await sb.from("matches").update({ [slot]: winner }).eq("id", m.next_match_id);
        }
      }
    }
  }

  return null; // no error
}

export async function generateKnockoutAction(tournamentId: string) {
  const session = await getSession();
  if (!session) return await loginRedirect();
  if (!(await assertCanEdit(tournamentId, session.profileId))) return { error: "ไม่มีสิทธิ์" };

  const sb = await createAdminClient();

  const { data: tournament } = await sb
    .from("tournaments")
    .select("advance_count, seeding_method, format, has_lower_bracket, allow_drop_to_lower, match_unit, pair_division_threshold")
    .eq("id", tournamentId)
    .single();
  if (!tournament) return { error: "ไม่พบทัวร์นาเมนต์" };

  // ── Pair mode ──
  if (tournament.match_unit === "pair") {
    const { data: teamsData } = await sb.from("teams").select("id").eq("tournament_id", tournamentId);
    const teamIds = teamsData?.map((t) => t.id) ?? [];
    if (!teamIds.length) return { error: "ยังไม่มีทีม" };

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
    if (pairs.length < 2) return { error: "ต้องมีอย่างน้อย 2 คู่" };

    function pairSeed(p: RawPair): Seed {
      const label = [p.player1?.display_name, p.player2?.display_name].filter(Boolean).join(" / ") || p.id.slice(0, 6);
      return { teamId: p.id, name: label };
    }

    let allMatches: BracketMatchDef[];

    if (tournament.format === "group_knockout") {
      // Seed from group stage pair standings
      const { data: groupMatchesRaw } = await sb
        .from("matches").select("*").eq("tournament_id", tournamentId).eq("round_type", "group");
      const groupMatches = (groupMatchesRaw ?? []) as Match[];
      const standings = computeStandings(groupMatches, "pair", pairs.map((p) => p.id));

      const threshold = tournament.pair_division_threshold ?? null;
      const advanceCount = tournament.advance_count ?? 2;

      function pairDiv(pairId: string): "upper" | "lower" | null {
        if (threshold === null) return null;
        const p = pairs.find((x) => x.id === pairId);
        const n = parseFloat(p?.pair_level ?? "");
        return !isNaN(n) && n > threshold ? "upper" : "lower";
      }

      function seedsFromStandings(rows: typeof standings, count: number): Seed[] {
        return rows
          .slice(0, count)
          .map((s) => {
            const p = pairs.find((x) => x.id === s.competitorId);
            return p ? pairSeed(p) : null;
          })
          .filter((s): s is Seed => s !== null);
      }

      if (threshold === null) {
        let topSeeds = seedsFromStandings(standings, advanceCount);
        if (topSeeds.length < 2) return { error: "คู่ที่ผ่านรอบมีไม่ถึง 2 คู่" };
        if (tournament.seeding_method === "random") topSeeds = [...topSeeds].sort(() => Math.random() - 0.5);
        allMatches = buildBracket(toEntries(topSeeds, nextPowerOf2(topSeeds.length)));
      } else {
        const upperStandings = standings.filter((s) => pairDiv(s.competitorId) === "upper");
        const lowerStandings = standings.filter((s) => pairDiv(s.competitorId) === "lower");
        let upperSeeds = seedsFromStandings(upperStandings, advanceCount);
        let lowerSeeds = seedsFromStandings(lowerStandings, advanceCount);
        if (upperSeeds.length < 2 && lowerSeeds.length < 2) return { error: "ไม่มีคู่ที่ผ่านรอบเพียงพอในทั้งสอง division" };
        if (tournament.seeding_method === "random") {
          upperSeeds = [...upperSeeds].sort(() => Math.random() - 0.5);
          lowerSeeds = [...lowerSeeds].sort(() => Math.random() - 0.5);
        }
        if (upperSeeds.length >= 2 && lowerSeeds.length >= 2) {
          allMatches = buildIndependentDoubleBracket(upperSeeds, lowerSeeds);
        } else {
          const s = upperSeeds.length >= 2 ? upperSeeds : lowerSeeds;
          allMatches = buildBracket(toEntries(s, nextPowerOf2(s.length)));
        }
      }
    } else {
      // knockout_only — seed all pairs
      let pairSeeds = pairs.map(pairSeed);
      if (tournament.seeding_method === "random") pairSeeds = pairSeeds.sort(() => Math.random() - 0.5);
      allMatches = buildBracket(toEntries(pairSeeds, nextPowerOf2(pairSeeds.length)));
    }

    const err = await insertAndResolveByes(sb, tournamentId, allMatches, true);
    if (err) return err;

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
    notifyTournamentAdmins(tournamentId, "สร้างสายน็อกเอาต์แล้ว").catch(() => {});
    return { ok: true, count: allMatches.filter((m) => !m.isBye).length };
  }

  // ── Team mode ──
  let seeds: Seed[];
  let lowerSeeds: Seed[] = [];

  if (tournament.format === "knockout_only") {
    const { data: allTeams } = await sb
      .from("teams").select("id, name").eq("tournament_id", tournamentId).order("created_at");
    if (!allTeams || allTeams.length < 2) return { error: "ต้องมีอย่างน้อย 2 ทีม" };
    const list = tournament.seeding_method === "random"
      ? [...allTeams].sort(() => Math.random() - 0.5) : allTeams;
    seeds = list.map((t) => ({ teamId: t.id, name: t.name }));
  } else {
    const { data: groups } = await sb
      .from("groups")
      .select("id, group_teams(team_id, wins, draws, losses, points_for, points_against, team:teams(id, name, color))")
      .eq("tournament_id", tournamentId);
    if (!groups?.length) return { error: "ยังไม่มีกลุ่ม — แบ่งกลุ่มก่อน" };

    const advanceCount = tournament.advance_count ?? 2;
    type Advancer = Seed & { groupRank: number; pts: number; diff: number; pf: number };
    const advancers: Advancer[] = [];
    const lowerAdvancers: Advancer[] = [];

    for (const group of groups) {
      const ranked = rankGroupTeams(group.group_teams as unknown as GroupTeamRow[]);
      ranked.slice(0, advanceCount).forEach((t, i) => advancers.push({ ...t, groupRank: i + 1 }));
      if (tournament.has_lower_bracket && !tournament.allow_drop_to_lower) {
        ranked.slice(advanceCount, advanceCount * 2).forEach((t, i) =>
          lowerAdvancers.push({ ...t, groupRank: i + 1 })
        );
      }
    }

    if (advancers.length < 2) return { error: "ผู้เข้ารอบยังไม่ครบ — ต้องมีอย่างน้อย 2 ทีม" };

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

  const err = await insertAndResolveByes(sb, tournamentId, allMatches);
  if (err) return err;

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
  notifyTournamentAdmins(tournamentId, "สร้างสายน็อกเอาต์แล้ว").catch(() => {});
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
  if (!(await assertCanEdit(input.tournamentId, session.profileId))) return { error: "ไม่มีสิทธิ์" };
  if (input.pairAId === input.pairBId) return { error: "ต้องเลือกคู่ที่ต่างกัน" };

  const sb = await createAdminClient();

  const { data: pairsData } = await sb
    .from("pairs")
    .select("id, team_id, pair_level, teams!inner(tournament_id)")
    .in("id", [input.pairAId, input.pairBId]);

  if (!pairsData || pairsData.length !== 2) return { error: "ไม่พบคู่" };

  for (const p of pairsData) {
    const tid = (p.teams as unknown as { tournament_id: string }).tournament_id;
    if (tid !== input.tournamentId) return { error: "คู่ไม่ได้อยู่ใน tournament นี้" };
  }

  const pA = pairsData.find((p) => p.id === input.pairAId)!;
  const pB = pairsData.find((p) => p.id === input.pairBId)!;

  const { data: tournament } = await sb
    .from("tournaments")
    .select("pair_division_threshold")
    .eq("id", input.tournamentId)
    .single();

  const threshold = tournament?.pair_division_threshold ?? null;

  function pairDiv(level: string | null | undefined): "upper" | "lower" | null {
    if (threshold === null) return null;
    const n = parseFloat(level ?? "");
    return !isNaN(n) && n > threshold ? "upper" : "lower";
  }

  const divA = pairDiv(pA.pair_level as string | null);
  const divB = pairDiv(pB.pair_level as string | null);
  if (divA !== divB) return { error: "คู่ต้องอยู่ใน division เดียวกัน" };

  const { data: maxRow } = await sb
    .from("matches")
    .select("match_number")
    .eq("tournament_id", input.tournamentId)
    .eq("round_type", "group")
    .order("match_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { error } = await sb.from("matches").insert({
    tournament_id: input.tournamentId,
    round_type: "group",
    round_number: 1,
    match_number: (maxRow?.match_number ?? 0) + 1,
    pair_a_id: input.pairAId,
    pair_b_id: input.pairBId,
    team_a_id: pA.team_id,
    team_b_id: pB.team_id,
    division: divA,
    games: [],
    status: "pending",
  });

  if (error) return { error: "สร้างแมตช์ไม่สำเร็จ" };

  revalidatePath(`/tournaments/${input.tournamentId}`);
  await writeAuditLog({
    tournament_id: input.tournamentId,
    actor_id: session.profileId,
    actor_name: session.displayName,
    event_type: "match_created",
    entity_type: "match",
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
  if (!(await assertCanEdit(input.tournamentId, session.profileId))) return { error: "ไม่มีสิทธิ์" };

  if (!input.games.length) return { error: "ต้องมีอย่างน้อย 1 เกม" };

  const sb = await createAdminClient();

  const { data: match } = await sb.from("matches").select("*").eq("id", input.matchId).single();
  if (!match) return { error: "ไม่พบแมตช์" };

  const winner = gameWinner(input.games);
  const totals = sumGameScores(input.games);

  if (match.round_type === "knockout" && winner === "draw") {
    return { error: "แมตช์น็อกเอาต์ไม่อนุญาตให้เสมอ" };
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
  if (rpcError) return { error: "บันทึกผลไม่สำเร็จ" };

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
      const msg = `🏸 ${nameA} vs ${nameB}\nเกมที่ชนะ: ${gamesWonA}:${gamesWonB} (${gameDetail})\nผู้ชนะ: ${winnerName}`;
      await notifyTournamentAdmins(input.tournamentId, msg);
    } catch {}
  })();
  return { ok: true };
}

export async function resetMatchScoreAction(matchId: string, tournamentId: string) {
  const session = await getSession();
  if (!session) return await loginRedirect();
  if (!(await assertCanEdit(tournamentId, session.profileId))) return { error: "ไม่มีสิทธิ์" };

  const sb = await createAdminClient();
  const { data: match } = await sb.from("matches").select("*").eq("id", matchId).single();
  if (!match || match.status !== "completed") return { error: "แมตช์นี้ยังไม่มีคะแนน" };

  if (match.group_id && !match.pair_a_id && match.team_a_id && match.team_b_id) {
    const totals = sumGameScores(match.games);
    const winner = gameWinner(match.games);
    await reverseGroupTeamStandings(match.group_id, match.team_a_id, match.team_b_id, totals.a, totals.b, winner);
  }

  const isPair = !!(match.pair_a_id || match.pair_b_id);
  const colPrefix = isPair ? "pair" : "team";

  // Knockout: block reset if winner's next match already completed; clear winner slot
  if (match.round_type === "knockout" && match.next_match_id && match.next_match_slot) {
    const { data: nextMatch } = await sb.from("matches").select("status").eq("id", match.next_match_id).single();
    if (nextMatch?.status === "completed") return { error: "รีเซ็ตไม่ได้ — รอบถัดไปเล่นไปแล้ว" };
    const slot = `${colPrefix}_${match.next_match_slot}_id`;
    await sb.from("matches").update({ [slot]: null }).eq("id", match.next_match_id);
  }

  // Knockout: block reset if loser's next match already completed; clear loser slot
  if (match.round_type === "knockout" && match.loser_next_match_id && match.loser_next_match_slot) {
    const { data: loserNext } = await sb.from("matches").select("status").eq("id", match.loser_next_match_id).single();
    if (loserNext?.status === "completed") return { error: "รีเซ็ตไม่ได้ — แมตช์สายล่างถัดไปเล่นไปแล้ว" };
    const slot = `${colPrefix}_${match.loser_next_match_slot}_id`;
    await sb.from("matches").update({ [slot]: null }).eq("id", match.loser_next_match_id);
  }

  await sb.from("matches").update({
    games: [],
    team_a_score: null,
    team_b_score: null,
    winner_id: null,
    status: "pending",
  }).eq("id", matchId);

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

async function revalidateTournamentPaths(sb: Awaited<ReturnType<typeof createAdminClient>>, tournamentId: string) {
  revalidatePath(`/tournaments/${tournamentId}`);
  const { data } = await sb
    .from("tournaments")
    .select("share_token")
    .eq("id", tournamentId)
    .maybeSingle();
  if (data?.share_token) {
    revalidatePath(`/t/${data.share_token}`);
    revalidatePath(`/t/${data.share_token}/tv`);
  }
}

export async function reorderMatchQueueAction(
  tournamentId: string,
  orderedMatchIds: string[],
) {
  const session = await getSession();
  if (!session) return await loginRedirect();
  if (!(await assertCanEdit(tournamentId, session.profileId))) return { error: "ไม่มีสิทธิ์" };

  const sb = await createAdminClient();
  const { error: rpcErr } = await sb.rpc("reorder_tournament_queue", {
    p_tournament_id: tournamentId,
    p_ordered_ids: orderedMatchIds,
  });
  if (rpcErr) {
    if (rpcErr.code === "22023" || /matchId not in tournament/i.test(rpcErr.message ?? "")) {
      return { error: "พบ matchId ที่ไม่อยู่ในทัวร์นาเมนต์นี้" };
    }
    return { error: "บันทึกลำดับไม่สำเร็จ" };
  }

  await revalidateTournamentPaths(sb, tournamentId);
  await writeAuditLog({
    tournament_id: tournamentId,
    actor_id: session.profileId,
    actor_name: session.displayName,
    event_type: "queue_reordered",
    entity_type: "tournament",
    entity_id: tournamentId,
    description: `จัดลำดับคิว ${orderedMatchIds.length} แมตช์`,
  });
  return { ok: true };
}

export async function autoRotateQueueAction(tournamentId: string, restGap = 2) {
  const session = await getSession();
  if (!session) return await loginRedirect();
  if (!(await assertCanEdit(tournamentId, session.profileId))) return { error: "ไม่มีสิทธิ์" };

  const sb = await createAdminClient();

  // Pending matches in current queue order
  const { data: pending, error } = await sb
    .from("matches")
    .select("id, queue_position, match_number, team_a_id, team_b_id, pair_a_id, pair_b_id")
    .eq("tournament_id", tournamentId)
    .eq("status", "pending")
    .order("queue_position", { ascending: true, nullsFirst: false })
    .order("match_number");
  if (error) return { error: "อ่านรายการแมตช์ไม่สำเร็จ" };
  if (!pending || pending.length < 2) return { ok: true, rotated: 0 };

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

  // Seed "recent" with in-progress players so the next pick rests them.
  const inProgressPlayers = new Set<string>();
  for (const m of (inProgress as SlotRow[]) ?? []) {
    for (const p of playersOf(m)) inProgressPlayers.add(p);
  }

  // Greedy: pick earliest match whose players don't appear in last `restGap` placed
  // matches (and aren't currently on court if result is still empty).
  const remaining = [...pending];
  const result: typeof pending = [];
  while (remaining.length > 0) {
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

  let changed = 0;
  for (let i = 0; i < result.length; i++) {
    if (result[i].id !== pending[i].id) changed += 1;
  }
  if (changed === 0) return { ok: true, rotated: 0 };

  // Atomic re-assignment via RPC (matches existing replace_tournament_matches pattern)
  const orderedIds = result.map((m) => m.id);
  const { error: rpcErr } = await sb.rpc("reorder_tournament_queue", {
    p_tournament_id: tournamentId,
    p_ordered_ids: orderedIds,
  });
  if (rpcErr) return { error: "บันทึกลำดับใหม่ไม่สำเร็จ" };

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

export async function setMatchCourtAction(input: {
  matchId: string;
  tournamentId: string;
  court: string | null;
}) {
  const session = await getSession();
  if (!session) return await loginRedirect();
  if (!(await assertCanEdit(input.tournamentId, session.profileId))) return { error: "ไม่มีสิทธิ์" };

  const sb = await createAdminClient();
  const rawCourt = input.court?.trim() ?? "";
  const court = rawCourt.length > 0 ? rawCourt.slice(0, COURT_NAME_MAX) : null;

  if (court) {
    const { data: occupier } = await sb
      .from("matches")
      .select("id, match_number")
      .eq("tournament_id", input.tournamentId)
      .eq("status", "in_progress")
      .eq("court", court)
      .neq("id", input.matchId)
      .maybeSingle();
    if (occupier) {
      return { error: `สนาม ${court} ถูกใช้แมตช์ #${occupier.match_number} อยู่` };
    }
  }

  const { error } = await sb
    .from("matches")
    .update({ court })
    .eq("id", input.matchId)
    .eq("tournament_id", input.tournamentId);
  if (error) return { error: "บันทึกสนามไม่สำเร็จ" };

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
  if (!(await assertCanEdit(tournamentId, session.profileId))) return { error: "ไม่มีสิทธิ์" };

  const sb = await createAdminClient();
  const { data: match } = await sb
    .from("matches")
    .select("id, status, court, match_number, team_a_id, team_b_id, pair_a_id, pair_b_id")
    .eq("id", matchId)
    .eq("tournament_id", tournamentId)
    .maybeSingle();
  if (!match) return { error: "ไม่พบแมตช์" };
  if (match.status === "completed") return { error: "แมตช์นี้จบแล้ว" };
  if (match.status === "in_progress") return { error: "แมตช์นี้กำลังแข่งอยู่" };

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
      return { error: `สนาม ${match.court} ถูกใช้แมตช์ #${occupier.match_number} อยู่` };
    }
  }

  const { error } = await sb
    .from("matches")
    .update({ status: "in_progress" })
    .eq("id", matchId);
  if (error) {
    if (error.code === "23505") {
      return { error: `สนาม ${match.court ?? "—"} ถูกใช้อยู่ — เลือกสนามอื่นแล้วลองใหม่` };
    }
    return { error: "อัปเดตสถานะไม่สำเร็จ" };
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
      const msg = `🏸 เรียกแมตช์ #${match.match_number}${courtPart}\n${nameA} vs ${nameB}`;
      await notifyTournamentAdmins(tournamentId, msg);
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

  return { ok: true };
}

// ============ Internal helpers ============

async function updateGroupTeamStandings(
  groupId: string,
  aId: string | null,
  bId: string | null,
  scoreA: number,
  scoreB: number,
  winner: "a" | "b" | "draw"
) {
  if (!aId || !bId) return;
  const sb = await createAdminClient();
  const { data: rows } = await sb.from("group_teams").select("*").eq("group_id", groupId).in("team_id", [aId, bId]);
  if (!rows) return;

  for (const r of rows) {
    const isA = r.team_id === aId;
    const myScore = isA ? scoreA : scoreB;
    const oppScore = isA ? scoreB : scoreA;
    const won = (isA && winner === "a") || (!isA && winner === "b");
    const drew = winner === "draw";
    await sb.from("group_teams").update({
      wins: r.wins + (won ? 1 : 0),
      draws: r.draws + (drew ? 1 : 0),
      losses: r.losses + (!won && !drew ? 1 : 0),
      points_for: r.points_for + myScore,
      points_against: r.points_against + oppScore,
    }).eq("group_id", groupId).eq("team_id", r.team_id);
  }
}

async function reverseGroupTeamStandings(
  groupId: string,
  aId: string,
  bId: string,
  scoreA: number,
  scoreB: number,
  winner: "a" | "b" | "draw"
) {
  const sb = await createAdminClient();
  const { data: rows } = await sb.from("group_teams").select("*").eq("group_id", groupId).in("team_id", [aId, bId]);
  if (!rows) return;

  for (const r of rows) {
    const isA = r.team_id === aId;
    const myScore = isA ? scoreA : scoreB;
    const oppScore = isA ? scoreB : scoreA;
    const won = (isA && winner === "a") || (!isA && winner === "b");
    const drew = winner === "draw";
    await sb.from("group_teams").update({
      wins: Math.max(0, r.wins - (won ? 1 : 0)),
      draws: Math.max(0, r.draws - (drew ? 1 : 0)),
      losses: Math.max(0, r.losses - (!won && !drew ? 1 : 0)),
      points_for: Math.max(0, r.points_for - myScore),
      points_against: Math.max(0, r.points_against - oppScore),
    }).eq("group_id", groupId).eq("team_id", r.team_id);
  }
}
