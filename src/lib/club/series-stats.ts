// Cross-session member stats (ADR 0002 P4, decision #9 — read-only, optional
// phase). Pure aggregation over every session (นัด) of a club series, mirroring
// `dashboard.ts`'s style: plain functions over `Pick<>` row subsets, no I/O. The
// caller (series-home.tsx) fetches `club_players` + `club_matches` for every
// session of the series and passes the rows in; this module never touches
// Supabase and knows nothing about `series_members` (the registry — zero-
// appearance members are merged in by the view component, not here).
//
// Scope decisions (documented per the task brief — read before changing):
// - Only `status === 'completed'` matches count toward matchesPlayed/wins/
//   losses. pending/in_progress/cancelled are ignored — filtered HERE
//   (defensively) even though the caller's query narrows to 'completed'
//   already, mirroring `computeClubDashboard`'s own re-filter-on-status
//   pattern so this function is safe to call with an unfiltered list too.
// - `winner_side === null` on a completed match (no-result / walkover) counts
//   as a match PLAYED for every participant but contributes no win or loss.
// - A member is derived from `club_players.member_id`. Walk-ins (`member_id`
//   null) never appear in the output map — their attendance/match slots are
//   silently excluded, never misattributed to anyone else.
// - Data-corruption guard: if the SAME member_id appears on BOTH side A and
//   side B of one match (e.g. two stray `club_players` rows sharing a
//   member_id, one seated on each side), that match counts once toward
//   matchesPlayed for that member and contributes no win/loss — the result is
//   ambiguous, so we refuse to guess rather than double-count or pick a side.
// - `lastPlayDate` = the most recent session `play_date` the member ATTENDED
//   (has a `club_players` row for), not restricted to sessions where they had
//   a match slot — a member who showed up but never got a match still gets a
//   recency date. This reuses the same per-session attendance signal as
//   `sessionsAttended` rather than a separate "last match" lookup.

import type { ClubMatch, ClubPlayer } from "@/lib/types";

export type SeriesStatsSession = { id: string; play_date: string };
export type SeriesStatsPlayer = Pick<ClubPlayer, "id" | "club_id" | "member_id">;
export type SeriesStatsMatch = Pick<
  ClubMatch,
  | "club_id"
  | "status"
  | "winner_side"
  | "side_a_player1"
  | "side_a_player2"
  | "side_b_player1"
  | "side_b_player2"
>;

export type MemberStatsRow = {
  memberId: string;
  sessionsAttended: number;
  matchesPlayed: number;
  wins: number;
  losses: number;
  /** Most recent session play_date the member attended, or null (never attended — should not occur for a row present in the map). */
  lastPlayDate: string | null;
};

export type SeriesStatsData = {
  /** Sessions passed in — the series' total นัด count, regardless of whether any had matches. */
  totalSessions: number;
  /** Completed matches across every session (after the internal status filter). */
  totalMatches: number;
  /** Keyed by member_id. Only members with at least one attendance or match slot appear — the view component merges in zero-appearance registry members. */
  memberStats: Map<string, MemberStatsRow>;
};

function sideSlots(m: SeriesStatsMatch, side: "a" | "b"): (string | null)[] {
  return side === "a" ? [m.side_a_player1, m.side_a_player2] : [m.side_b_player1, m.side_b_player2];
}

export function computeSeriesStats(
  sessions: SeriesStatsSession[],
  players: SeriesStatsPlayer[],
  matches: SeriesStatsMatch[],
): SeriesStatsData {
  const playDateByClubId = new Map(sessions.map((s) => [s.id, s.play_date]));

  // club_players.id → member_id, walk-ins (member_id null) excluded.
  const memberIdByPlayerId = new Map<string, string>();
  for (const p of players) {
    if (p.member_id) memberIdByPlayerId.set(p.id, p.member_id);
  }

  const memberStats = new Map<string, MemberStatsRow>();
  const getRow = (memberId: string): MemberStatsRow => {
    let row = memberStats.get(memberId);
    if (!row) {
      row = { memberId, sessionsAttended: 0, matchesPlayed: 0, wins: 0, losses: 0, lastPlayDate: null };
      memberStats.set(memberId, row);
    }
    return row;
  };
  const bumpLastPlayDate = (row: MemberStatsRow, playDate: string | undefined) => {
    if (playDate && (!row.lastPlayDate || playDate > row.lastPlayDate)) row.lastPlayDate = playDate;
  };

  // ── Attendance: distinct (member_id, club_id) pairs → sessionsAttended + recency.
  const attendedClubIdsByMember = new Map<string, Set<string>>();
  for (const p of players) {
    if (!p.member_id) continue; // walk-in — excluded
    const row = getRow(p.member_id);
    let attended = attendedClubIdsByMember.get(p.member_id);
    if (!attended) {
      attended = new Set();
      attendedClubIdsByMember.set(p.member_id, attended);
    }
    if (!attended.has(p.club_id)) {
      attended.add(p.club_id);
      row.sessionsAttended += 1;
    }
    bumpLastPlayDate(row, playDateByClubId.get(p.club_id));
  }

  // ── Matches: completed only.
  const completed = matches.filter((m) => m.status === "completed");
  for (const m of completed) {
    const sideAMembers = new Set(
      sideSlots(m, "a")
        .filter((id): id is string => Boolean(id))
        .map((id) => memberIdByPlayerId.get(id))
        .filter((id): id is string => Boolean(id)),
    );
    const sideBMembers = new Set(
      sideSlots(m, "b")
        .filter((id): id is string => Boolean(id))
        .map((id) => memberIdByPlayerId.get(id))
        .filter((id): id is string => Boolean(id)),
    );

    const allMembers = new Set([...sideAMembers, ...sideBMembers]);
    for (const memberId of allMembers) {
      const row = getRow(memberId);
      row.matchesPlayed += 1;

      const onA = sideAMembers.has(memberId);
      const onB = sideBMembers.has(memberId);
      if (onA && onB) continue; // corruption guard — played once, no win/loss
      if (!m.winner_side) continue; // no-result completed match — played, no win/loss

      const won = (onA && m.winner_side === "a") || (onB && m.winner_side === "b");
      if (won) row.wins += 1;
      else row.losses += 1;
    }
  }

  return {
    totalSessions: sessions.length,
    totalMatches: completed.length,
    memberStats,
  };
}
