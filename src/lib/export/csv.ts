import type { Match, Team, TeamPlayer, PairWithPlayers, MatchUnit } from "@/lib/types";
import { gameWinner, sumGameScores } from "@/lib/tournament/scoring";
import { parseDivision } from "@/lib/tournament/divisions";
import { embeddedReal } from "@/lib/tournament/levels";

export function escapeCsv(v: string | number | null | undefined): string {
  const s = String(v ?? "");
  return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s.replace(/"/g, '""')}"` : s;
}

export function csvRow(...cols: (string | number | null | undefined)[]): string {
  return cols.map(escapeCsv).join(",");
}

const row = csvRow;

// ── Label interfaces (callers build from t(); lib stays pure) ─────────────────

export interface MatchesCsvLabels {
  /** Column header: match number */
  colMatchNo: string;
  /** Column header: round name */
  colRound: string;
  /** Column header: round number / bracket section */
  colBracket: string;
  /** Column header: side A (team) */
  colTeamA: string;
  /** Column header: side B (team) */
  colTeamB: string;
  /** Column header: side A (pair) */
  colPairA: string;
  /** Column header: side B (pair) */
  colPairB: string;
  /** Column header: games won by side A */
  colGamesA: string;
  /** Column header: games won by side B */
  colGamesB: string;
  /** Column header: total points side A */
  colPointsA: string;
  /** Column header: total points side B */
  colPointsB: string;
  /** Column header: per-game score detail */
  colGameDetail: string;
  /** Column header: winner */
  colWinner: string;
  /** Column header: match status */
  colStatus: string;
  /** Round-type label: group stage */
  roundGroup: string;
  /** Bracket label: upper / winner bracket */
  bracketUpper: string;
  /** Bracket label: lower / loser bracket */
  bracketLower: string;
  /** Bracket label: grand final */
  bracketGrandFinal: string;
  /** Bracket label: generic knockout fallback */
  bracketKnockout: string;
  /** Status label: pending */
  statusPending: string;
  /** Status label: in progress */
  statusInProgress: string;
  /** Status label: completed */
  statusCompleted: string;
  /** Winner label when match is drawn */
  winnerDraw: string;
}

export interface RosterCsvLabels {
  /** Column header: team name */
  colTeam: string;
  /** Column header: team colour */
  colColor: string;
  /** Column header: player name */
  colPlayerName: string;
  /** Column header: role */
  colRole: string;
  /** Column header: pair name */
  colPairName: string;
  /** Role label: captain */
  roleCaptain: string;
  /** Role label: member */
  roleMember: string;
}

export interface PlayerTemplateSampleLabels {
  /** Sample team name 1 (red) */
  sampleTeamRed: string;
  /** Sample team name 2 (green) */
  sampleTeamGreen: string;
  /** Sample player names (6 entries) */
  sampleNames: [string, string, string, string, string, string];
}

// ── Matches CSV ───────────────────────────────────────────────────────────────

export function generateMatchesCsv(
  matches: Match[],
  teams: Team[],
  pairs: PairWithPlayers[],
  unit: MatchUnit,
  labels: MatchesCsvLabels,
): string {
  const teamById = new Map(teams.map((t) => [t.id, t]));
  const pairById = new Map(pairs.map((p) => [p.id, p]));

  function competitorName(id: string | null, kind: "team" | "pair"): string {
    if (!id) return "—";
    if (kind === "team") return teamById.get(id)?.name ?? id;
    const p = pairById.get(id);
    if (!p) return id;
    return p.display_pair_name ?? [p.player1?.display_name, p.player2?.display_name].filter(Boolean).join(" / ");
  }

  function roundLabel(m: Match): string {
    if (m.round_type === "group") return labels.roundGroup;
    const bracketMap: Record<string, string> = {
      upper: labels.bracketUpper,
      lower: labels.bracketLower,
      grand_final: labels.bracketGrandFinal,
    };
    return bracketMap[m.bracket ?? "upper"] ?? labels.bracketKnockout;
  }

  const headers = row(
    labels.colMatchNo, labels.colRound, labels.colBracket,
    unit === "pair" ? labels.colPairA : labels.colTeamA,
    unit === "pair" ? labels.colPairB : labels.colTeamB,
    "Division",
    labels.colGamesA, labels.colGamesB,
    labels.colPointsA, labels.colPointsB,
    labels.colGameDetail, labels.colWinner, labels.colStatus,
  );

  const lines = matches
    .filter((m) => m.round_type === "group" || m.round_type === "knockout")
    .sort((a, b) => a.match_number - b.match_number)
    .map((m) => {
      const isPair = unit === "pair" && (m.pair_a_id || m.pair_b_id);
      const aId = isPair ? m.pair_a_id : m.team_a_id;
      const bId = isPair ? m.pair_b_id : m.team_b_id;
      const kind = isPair ? "pair" : "team";

      const aName = competitorName(aId, kind);
      const bName = competitorName(bId, kind);

      const totals = m.games.length ? sumGameScores(m.games) : null;
      const winner = m.games.length ? gameWinner(m.games) : null;
      const gamesA = m.team_a_score ?? 0;
      const gamesB = m.team_b_score ?? 0;
      const gameDetail = m.games.map((g) => `${g.a}-${g.b}`).join(", ");
      const winnerName = winner === "a" ? aName : winner === "b" ? bName : labels.winnerDraw;
      const statusMap: Record<string, string> = {
        pending: labels.statusPending,
        in_progress: labels.statusInProgress,
        completed: labels.statusCompleted,
      };

      const divisionNum = parseDivision(m.division);
      return row(
        m.match_number, roundLabel(m), m.round_number,
        aName, bName,
        divisionNum !== null ? divisionNum : "",
        m.status === "completed" ? gamesA : "",
        m.status === "completed" ? gamesB : "",
        m.status === "completed" && totals ? totals.a : "",
        m.status === "completed" && totals ? totals.b : "",
        m.status === "completed" ? gameDetail : "",
        m.status === "completed" ? winnerName : "",
        statusMap[m.status] ?? m.status
      );
    });

  return [headers, ...lines].join("\n");
}

// ── Roster CSV ────────────────────────────────────────────────────────────────

export function generateRosterCsv(
  teams: (Team & { players: TeamPlayer[] })[],
  pairs: PairWithPlayers[],
  labels: RosterCsvLabels,
): string {
  const pairByPlayerId = new Map<string, PairWithPlayers>();
  for (const p of pairs) {
    if (p.player_id_1) pairByPlayerId.set(p.player_id_1, p);
    if (p.player_id_2) pairByPlayerId.set(p.player_id_2, p);
  }

  // NOTE: id_player / pair_id / pair_level are canonical import keys — kept as-is.
  const headers = row(labels.colTeam, labels.colColor, "id_player", labels.colPlayerName, labels.colRole, "Level", "pair_id", labels.colPairName, "pair_level");

  const lines: string[] = [];
  for (const t of teams) {
    const sorted = [...t.players].sort((a, b) =>
      a.role === "captain" ? -1 : b.role === "captain" ? 1 : 0
    );
    for (const p of sorted) {
      const pair = pairByPlayerId.get(p.id);
      const pairName = pair ? pair.display_pair_name ?? [pair.player1?.display_name, pair.player2?.display_name].filter(Boolean).join(" / ") : "";
      const lvl = embeddedReal(p.levels);
      lines.push(row(t.name, t.color ?? "", p.csv_id ?? "", p.display_name, p.role === "captain" ? labels.roleCaptain : labels.roleMember, lvl != null ? String(lvl) : "", pair?.id ?? "", pairName, pair?.pair_level ?? ""));
    }
  }

  return [headers, ...lines].join("\n");
}

// ── Templates ─────────────────────────────────────────────────────────────────

// IMPORTANT: The header lines below use the EXACT canonical column ids required
// by the import parser in csv-import-dialog.tsx (parseFile lowercases headers
// and checks for these literal strings). Do NOT translate or rename them.
// Only the sample DATA rows may be localized.

export function generatePlayerImportTemplate(labels: PlayerTemplateSampleLabels): string {
  const [n1, n2, n3, n4, n5, n6] = labels.sampleNames;
  return [
    "team,color,id_player,display_name,role,level",
    `${labels.sampleTeamRed},#ef4444,R1-1a,${n1},captain,A`,
    `${labels.sampleTeamRed},#ef4444,R1-1b,${n2},member,B`,
    `${labels.sampleTeamRed},#ef4444,R1-2a,${n3},member,B`,
    `${labels.sampleTeamRed},#ef4444,R1-2b,${n4},member,C`,
    `${labels.sampleTeamGreen},#22c55e,G1-1a,${n5},member,A`,
    `${labels.sampleTeamGreen},#22c55e,G1-1b,${n6},member,B`,
  ].join("\n");
}

// Pre-filled pair template from existing players (csv_id already set)
// IMPORTANT: The header line uses the EXACT canonical column ids required by
// the import parser in csv-import-dialog.tsx. Do NOT translate them.
// Data rows contain only player IDs and team names (no locale-sensitive content).
export function generatePairImportTemplate(
  teams: (Team & { players: TeamPlayer[] })[],
  classCodes: string[] = [],
): string {
  // class_code column included only for competition-mode tournaments (classes present).
  const withClass = classCodes.length > 0;
  const sampleCode = classCodes[0] ?? "";
  const lines = [withClass ? "team,pair_id,id_player_1,id_player_2,pair_name,class_code" : "team,pair_id,id_player_1,id_player_2,pair_name"];

  // Derive team prefix from player csv_id (e.g. "R1-1a" → "R1")
  function teamPrefix(csvId: string | null | undefined, fallback: string): string {
    if (!csvId) return fallback;
    const parts = csvId.split("-");
    return parts.length > 1 ? parts.slice(0, -1).join("-") : csvId;
  }

  for (const t of teams) {
    const sorted = [...t.players].sort((a, b) =>
      a.role === "captain" ? -1 : b.role === "captain" ? 1 : 0
    );
    const prefix = teamPrefix(sorted[0]?.csv_id, t.name.slice(0, 3));
    for (let i = 0; i + 1 < sorted.length; i += 2) {
      const p1 = sorted[i];
      const p2 = sorted[i + 1];
      lines.push(
        withClass
          ? row(t.name, "", p1.csv_id ?? p1.id.slice(0, 8), p2.csv_id ?? p2.id.slice(0, 8), "", sampleCode)
          : row(t.name, "", p1.csv_id ?? p1.id.slice(0, 8), p2.csv_id ?? p2.id.slice(0, 8), ""),
      );
    }
    if (sorted.length > 0) lines.push("");
  }
  return lines.join("\n");
}

// ── Download helper ───────────────────────────────────────────────────────────

export function downloadCsv(csv: string, filename: string) {
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}
