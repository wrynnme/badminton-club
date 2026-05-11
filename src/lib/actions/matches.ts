"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/auth/session";
import { generateAllPairMatches } from "@/lib/tournament/scheduling";
import { gameWinner, sumGameScores } from "@/lib/tournament/scoring";
import { buildBracket, nextPowerOf2 } from "@/lib/tournament/bracket";
import type { BracketEntry } from "@/lib/tournament/bracket";
import type { Game } from "@/lib/types";

async function loginRedirect(): Promise<never> {
  const h = await headers();
  const referer = h.get("referer");
  const redirectTo = referer ? new URL(referer).pathname : "/tournaments";
  redirect(`/?auth_error=login_required&redirectTo=${encodeURIComponent(redirectTo)}`);
}

async function assertOwner(tournamentId: string, profileId: string): Promise<boolean> {
  const sb = await createAdminClient();
  const { data } = await sb.from("tournaments").select("owner_id").eq("id", tournamentId).single();
  return data?.owner_id === profileId;
}

// ============ TEAM MODE ============

export async function generateGroupsAction(tournamentId: string, groupCount: number) {
  const session = await getSession();
  if (!session) return await loginRedirect();
  if (!(await assertOwner(tournamentId, session.profileId))) return { error: "ไม่มีสิทธิ์" };

  const sb = await createAdminClient();
  const { data: teams } = await sb.from("teams").select("id").eq("tournament_id", tournamentId);
  if (!teams?.length) return { error: "ยังไม่มีทีม" };

  await sb.from("matches").delete().eq("tournament_id", tournamentId).eq("round_type", "group");
  await sb.from("groups").delete().eq("tournament_id", tournamentId);

  const shuffled = [...teams].sort(() => Math.random() - 0.5);
  const names = "ABCDEFGHIJKLMNOP".split("").slice(0, groupCount);

  const { data: groups } = await sb
    .from("groups")
    .insert(names.map((n) => ({ tournament_id: tournamentId, name: `กลุ่ม ${n}` })))
    .select("id");
  if (!groups) return { error: "สร้างกลุ่มไม่สำเร็จ" };

  await sb.from("group_teams").insert(
    shuffled.map((team, i) => ({ group_id: groups[i % groupCount].id, team_id: team.id }))
  );

  revalidatePath(`/tournaments/${tournamentId}`);
  return { ok: true };
}

export async function generateGroupMatchesAction(tournamentId: string) {
  const session = await getSession();
  if (!session) return await loginRedirect();
  if (!(await assertOwner(tournamentId, session.profileId))) return { error: "ไม่มีสิทธิ์" };

  const sb = await createAdminClient();
  await sb.from("matches").delete().eq("tournament_id", tournamentId).eq("round_type", "group");

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
          tournament_id: tournamentId,
          group_id: g.id,
          round_type: "group",
          round_number: 1,
          match_number: n++,
          team_a_id: teamIds[i],
          team_b_id: teamIds[j],
        });
      }
    }
  }

  if (inserts.length) await sb.from("matches").insert(inserts);

  revalidatePath(`/tournaments/${tournamentId}`);
  return { ok: true, count: inserts.length };
}

// ============ PAIR MODE ============

export async function generatePairMatchesAction(tournamentId: string) {
  const session = await getSession();
  if (!session) return await loginRedirect();
  if (!(await assertOwner(tournamentId, session.profileId))) return { error: "ไม่มีสิทธิ์" };

  const sb = await createAdminClient();

  // Clear existing pair matches
  await sb.from("matches").delete().eq("tournament_id", tournamentId).eq("round_type", "group");

  // Fetch teams with their pairs
  const { data: teams } = await sb
    .from("teams")
    .select("id, pairs(id)")
    .eq("tournament_id", tournamentId);
  if (!teams?.length) return { error: "ยังไม่มีทีม" };

  type RawTeam = { id: string; pairs: { id: string }[] };
  const teamPairs = (teams as RawTeam[])
    .map((t) => ({ teamId: t.id, pairIds: t.pairs.map((p) => p.id) }))
    .filter((tp) => tp.pairIds.length > 0);

  if (teamPairs.length < 2) return { error: "ต้องมีอย่างน้อย 2 ทีมที่มีคู่" };

  const matches = generateAllPairMatches(teamPairs);

  const inserts = matches.map((m, i) => ({
    tournament_id: tournamentId,
    round_type: "group",
    round_number: 1,
    match_number: i + 1,
    team_a_id: m.teamAId,
    team_b_id: m.teamBId,
    pair_a_id: m.pairAId,
    pair_b_id: m.pairBId,
  }));

  if (inserts.length) await sb.from("matches").insert(inserts);

  revalidatePath(`/tournaments/${tournamentId}`);
  return { ok: true, count: inserts.length };
}

// ============ KNOCKOUT ============

export async function generateKnockoutAction(tournamentId: string) {
  const session = await getSession();
  if (!session) return await loginRedirect();
  if (!(await assertOwner(tournamentId, session.profileId))) return { error: "ไม่มีสิทธิ์" };

  const sb = await createAdminClient();

  const { data: tournament } = await sb
    .from("tournaments")
    .select("advance_count, seeding_method, format")
    .eq("id", tournamentId)
    .single();
  if (!tournament) return { error: "ไม่พบทัวร์นาเมนต์" };

  type Seed = { teamId: string; name: string };
  let seeds: Seed[];

  if (tournament.format === "knockout_only") {
    const { data: allTeams } = await sb
      .from("teams")
      .select("id, name, color")
      .eq("tournament_id", tournamentId)
      .order("created_at");
    if (!allTeams || allTeams.length < 2) return { error: "ต้องมีอย่างน้อย 2 ทีม" };
    const list = tournament.seeding_method === "random"
      ? [...allTeams].sort(() => Math.random() - 0.5)
      : allTeams;
    seeds = list.map((t) => ({ teamId: t.id, name: t.name }));
  } else {
    // group_knockout: advance top N from each group
    type GroupTeamRow = {
      team_id: string;
      wins: number;
      draws: number;
      losses: number;
      points_for: number;
      points_against: number;
      team: { id: string; name: string; color: string | null } | null;
    };

    const { data: groups } = await sb
      .from("groups")
      .select("id, group_teams(team_id, wins, draws, losses, points_for, points_against, team:teams(id, name, color))")
      .eq("tournament_id", tournamentId);
    if (!groups?.length) return { error: "ยังไม่มีกลุ่ม กรุณาแบ่งกลุ่มก่อน" };

    const advanceCount = tournament.advance_count ?? 2;
    type Advancer = Seed & { groupRank: number; pts: number; diff: number; pf: number };
    const advancers: Advancer[] = [];

    for (const group of groups) {
      const ranked = (group.group_teams as unknown as GroupTeamRow[])
        .map((gt) => ({
          teamId: gt.team_id,
          name: gt.team?.name ?? "—",
          pts: gt.wins * 3 + gt.draws,
          diff: gt.points_for - gt.points_against,
          pf: gt.points_for,
        }))
        .sort((a, b) => b.pts - a.pts || b.diff - a.diff || b.pf - a.pf);
      ranked.slice(0, advanceCount).forEach((t, i) =>
        advancers.push({ ...t, groupRank: i + 1 })
      );
    }

    if (advancers.length < 2) return { error: "ต้องมีผู้เข้ารอบอย่างน้อย 2 ทีม" };

    seeds = tournament.seeding_method === "by_group_score"
      ? [...advancers].sort((a, b) => a.groupRank - b.groupRank || b.pts - a.pts || b.diff - a.diff || b.pf - a.pf)
      : [...advancers].sort(() => Math.random() - 0.5);
  }

  const bracketSize = nextPowerOf2(seeds.length);
  const entries: BracketEntry[] = [
    ...seeds.map((s) => ({ teamId: s.teamId, label: s.name })),
    ...Array(bracketSize - seeds.length).fill({ teamId: null, label: "BYE" }),
  ];

  // Delete existing knockout matches
  await sb.from("matches").delete().eq("tournament_id", tournamentId).eq("round_type", "knockout");

  const bracketMatches = buildBracket(entries);

  const inserts = bracketMatches.map((m) => ({
    id: m.id,
    tournament_id: tournamentId,
    round_type: "knockout",
    round_number: m.roundNumber,
    match_number: m.matchNumber,
    team_a_id: m.teamAId,
    team_b_id: m.teamBId,
    next_match_id: m.nextMatchId,
    next_match_slot: m.nextMatchSlot,
    status: "pending",
    games: [],
  }));

  const { error: insertErr } = await sb.from("matches").insert(inserts);
  if (insertErr) return { error: insertErr.message };

  // Auto-complete BYE matches and advance their winners
  for (const m of bracketMatches.filter((bm) => bm.isBye)) {
    const winner = m.teamAId ?? m.teamBId;
    await sb.from("matches").update({ status: "completed", winner_id: winner }).eq("id", m.id);
    if (m.nextMatchId && m.nextMatchSlot && winner) {
      const slot = m.nextMatchSlot === "a" ? "team_a_id" : "team_b_id";
      await sb.from("matches").update({ [slot]: winner }).eq("id", m.nextMatchId);
    }
  }

  revalidatePath(`/tournaments/${tournamentId}`);
  return { ok: true, count: bracketMatches.filter((bm) => !bm.isBye).length };
}

// ============ SCORE ENTRY ============

export async function recordMatchScoreAction(input: {
  matchId: string;
  tournamentId: string;
  games: Game[];
}) {
  const session = await getSession();
  if (!session) return await loginRedirect();
  if (!(await assertOwner(input.tournamentId, session.profileId))) return { error: "ไม่มีสิทธิ์" };

  if (!input.games.length) return { error: "ต้องมีอย่างน้อย 1 เกม" };

  const sb = await createAdminClient();

  const { data: match } = await sb.from("matches").select("*").eq("id", input.matchId).single();
  if (!match) return { error: "ไม่พบแมตช์" };

  const winner = gameWinner(input.games);
  const totals = sumGameScores(input.games);

  // For team-mode: winner = team_a/b_id, for pair-mode: winner = pair_a/b_id (but matches table uses team_id for winner)
  // Use the appropriate id based on which is set
  const aId = match.team_a_id;
  const bId = match.team_b_id;
  const winnerTeamId = winner === "a" ? aId : winner === "b" ? bId : null;

  let gamesWonA = 0, gamesWonB = 0;
  for (const g of input.games) {
    if (g.a > g.b) gamesWonA++;
    else if (g.b > g.a) gamesWonB++;
  }

  await sb.from("matches").update({
    games: input.games,
    team_a_score: gamesWonA,
    team_b_score: gamesWonB,
    winner_id: winnerTeamId,
    status: "completed",
  }).eq("id", input.matchId);

  // Update group_teams standings only for team-mode group matches (not pair)
  if (match.group_id && !match.pair_a_id) {
    await updateGroupTeamStandings(match.group_id, aId, bId, totals.a, totals.b, winner);
  }

  // Knockout: auto-advance winner to next match
  if (match.round_type === "knockout" && winnerTeamId && match.next_match_id && match.next_match_slot) {
    const slot = match.next_match_slot === "a" ? "team_a_id" : "team_b_id";
    await sb.from("matches").update({ [slot]: winnerTeamId }).eq("id", match.next_match_id);
  }

  revalidatePath(`/tournaments/${input.tournamentId}`);
  return { ok: true };
}

export async function resetMatchScoreAction(matchId: string, tournamentId: string) {
  const session = await getSession();
  if (!session) return await loginRedirect();
  if (!(await assertOwner(tournamentId, session.profileId))) return { error: "ไม่มีสิทธิ์" };

  const sb = await createAdminClient();
  const { data: match } = await sb.from("matches").select("*").eq("id", matchId).single();
  if (!match || match.status !== "completed") return { error: "ยังไม่มีผล" };

  if (match.group_id && !match.pair_a_id && match.team_a_id && match.team_b_id) {
    const totals = sumGameScores(match.games);
    const winner = gameWinner(match.games);
    await reverseGroupTeamStandings(match.group_id, match.team_a_id, match.team_b_id, totals.a, totals.b, winner);
  }

  // Knockout: block reset if next match is already completed; otherwise clear the slot
  if (match.round_type === "knockout" && match.next_match_id && match.next_match_slot) {
    const { data: nextMatch } = await sb.from("matches").select("status").eq("id", match.next_match_id).single();
    if (nextMatch?.status === "completed") return { error: "รอบถัดไปเล่นไปแล้ว ไม่สามารถรีเซ็ตได้" };
    const slot = match.next_match_slot === "a" ? "team_a_id" : "team_b_id";
    await sb.from("matches").update({ [slot]: null }).eq("id", match.next_match_id);
  }

  await sb.from("matches").update({
    games: [],
    team_a_score: null,
    team_b_score: null,
    winner_id: null,
    status: "pending",
  }).eq("id", matchId);

  revalidatePath(`/tournaments/${tournamentId}`);
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
