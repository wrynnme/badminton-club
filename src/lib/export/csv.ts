import type { Match, Team, TeamPlayer, PairWithPlayers, MatchUnit } from "@/lib/types";
import { gameWinner, sumGameScores } from "@/lib/tournament/scoring";

function escapeCsv(v: string | number | null | undefined): string {
  const s = String(v ?? "");
  return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s.replace(/"/g, '""')}"` : s;
}

function row(...cols: (string | number | null | undefined)[]): string {
  return cols.map(escapeCsv).join(",");
}

function roundLabel(m: Match): string {
  if (m.round_type === "group") return "กลุ่ม";
  const bracketMap: Record<string, string> = { upper: "สายบน", lower: "สายล่าง", grand_final: "Grand Final" };
  return bracketMap[m.bracket ?? "upper"] ?? "Knockout";
}

// ── Matches CSV ───────────────────────────────────────────────────────────────

export function generateMatchesCsv(
  matches: Match[],
  teams: Team[],
  pairs: PairWithPlayers[],
  unit: MatchUnit
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

  const headers = row(
    "แมตช์", "รอบ", "สาย",
    unit === "pair" ? "คู่ A" : "ทีม A",
    unit === "pair" ? "คู่ B" : "ทีม B",
    "เกมที่ชนะ A", "เกมที่ชนะ B",
    "แต้มรวม A", "แต้มรวม B",
    "รายละเอียดเกม", "ผู้ชนะ", "สถานะ"
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
      const winnerName = winner === "a" ? aName : winner === "b" ? bName : "เสมอ";
      const statusMap: Record<string, string> = { pending: "รอ", in_progress: "กำลังแข่ง", completed: "จบแล้ว" };

      return row(
        m.match_number, roundLabel(m), m.round_number,
        aName, bName,
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

export function generateRosterCsv(teams: (Team & { players: TeamPlayer[] })[], pairs: PairWithPlayers[]): string {
  const pairByPlayerId = new Map<string, PairWithPlayers>();
  for (const p of pairs) {
    if (p.player_id_1) pairByPlayerId.set(p.player_id_1, p);
    if (p.player_id_2) pairByPlayerId.set(p.player_id_2, p);
  }

  const headers = row("ทีม", "สี", "id_player", "ชื่อผู้เล่น", "ตำแหน่ง", "Level", "pair_code", "คู่", "pair_level");

  const lines: string[] = [];
  for (const t of teams) {
    const sorted = [...t.players].sort((a, b) =>
      a.role === "captain" ? -1 : b.role === "captain" ? 1 : 0
    );
    for (const p of sorted) {
      const pair = pairByPlayerId.get(p.id);
      const pairName = pair ? pair.display_pair_name ?? [pair.player1?.display_name, pair.player2?.display_name].filter(Boolean).join(" / ") : "";
      lines.push(row(t.name, t.color ?? "", p.csv_id ?? "", p.display_name, p.role === "captain" ? "หัวหน้า" : "สมาชิก", p.level ?? "", pair?.pair_code ?? "", pairName, pair?.pair_level ?? ""));
    }
  }

  return [headers, ...lines].join("\n");
}

// ── Templates ─────────────────────────────────────────────────────────────────

export function generatePlayerImportTemplate(): string {
  return [
    "team,color,id_player,display_name,role,level",
    "ทีมแดง,#ef4444,R1-1a,ชื่อ นามสกุล,captain,A",
    "ทีมแดง,#ef4444,R1-1b,ชื่อ นามสกุล 2,member,B",
    "ทีมแดง,#ef4444,R1-2a,ชื่อ นามสกุล 3,member,B",
    "ทีมแดง,#ef4444,R1-2b,ชื่อ นามสกุล 4,member,C",
    "ทีมเขียว,#22c55e,G1-1a,ชื่อ นามสกุล 5,member,A",
    "ทีมเขียว,#22c55e,G1-1b,ชื่อ นามสกุล 6,member,B",
  ].join("\n");
}

// Pre-filled pair template from existing players (csv_id already set)
export function generatePairImportTemplate(teams: (Team & { players: TeamPlayer[] })[]): string {
  const lines = ["team,pair_code,id_player_1,id_player_2,pair_name,pair_level"];

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
      const pairCode = `${prefix}-P${Math.floor(i / 2) + 1}`;
      lines.push(row(t.name, pairCode, p1.csv_id ?? p1.id.slice(0, 8), p2.csv_id ?? p2.id.slice(0, 8), "", ""));
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
