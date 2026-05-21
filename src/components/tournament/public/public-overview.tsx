import { Trophy } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MatchRow } from "@/components/tournament/match-row";
import { buildCompetitorMap } from "@/lib/tournament/competitor";
import { computeStandings, aggregatePairStandingsToTeams, type StandingRow } from "@/lib/tournament/scoring";
import { computePairDivision, parsePairLevel, divisionLabelTh, divisionTone, divisionCount, parseTournamentThresholds } from "@/lib/tournament/divisions";
import type { Tournament, TeamWithPlayers, PairWithPlayers, Match, Team } from "@/lib/types";

export function PublicOverview({
  tournament,
  teams: _teams,
  flatTeams,
  pairs,
  allMatches,
}: {
  tournament: Tournament;
  teams: TeamWithPlayers[];
  flatTeams: Team[];
  pairs: PairWithPlayers[];
  allMatches: Match[];
}) {
  const unit = tournament.match_unit;
  const competitorMap = buildCompetitorMap(unit, flatTeams, pairs);
  const teamMap = new Map(flatTeams.map((t) => [t.id, t]));

  // Empty state — no matches generated yet
  if (allMatches.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
        <Trophy className="h-16 w-16 mb-4 opacity-20" />
        <p className="text-lg font-medium">ยังไม่มีการแข่งขัน</p>
        <p className="text-sm mt-1">เริ่มเร็วๆ นี้</p>
      </div>
    );
  }

  // ── Section 1: Team total scores (works for both team & pair modes) ──
  const teamIds = flatTeams.map((t) => t.id);
  const pairIds = pairs.map((p) => p.id);
  const pairStandingsAll: StandingRow[] =
    unit === "pair" ? computeStandings(allMatches, "pair", pairIds) : [];
  const teamTotals: StandingRow[] =
    unit === "team"
      ? computeStandings(allMatches, "team", teamIds)
      : aggregatePairStandingsToTeams(pairStandingsAll, pairs, flatTeams);
  const teamTotalsPlayed = teamTotals.filter((s) => s.played > 0);

  // ── Section 2: Pair standings split by division (pair mode only) ──
  const thresholds: number[] = parseTournamentThresholds(tournament.pair_division_thresholds);
  // Build per-division buckets (1..N) when thresholds are set
  const N = divisionCount(thresholds);
  const divisionBuckets = new Map<number, StandingRow[]>();
  if (unit === "pair" && thresholds.length > 0) {
    const pairLevelById = new Map(
      pairs.map((p) => [p.id, parsePairLevel(p.pair_level)]),
    );
    for (const s of pairStandingsAll) {
      const lv = pairLevelById.get(s.competitorId) ?? null;
      const div = computePairDivision(lv, thresholds) ?? N;
      const arr = divisionBuckets.get(div) ?? [];
      arr.push(s);
      divisionBuckets.set(div, arr);
    }
  }

  // ── Section 3: Queue (in-progress + next pending) ──
  const inProgress = allMatches
    .filter((m) => m.status === "in_progress")
    .sort((a, b) => {
      const ap = a.queue_position ?? a.match_number;
      const bp = b.queue_position ?? b.match_number;
      return ap - bp;
    });
  const aId = (m: Match) => (unit === "team" ? m.team_a_id : m.pair_a_id);
  const bId = (m: Match) => (unit === "team" ? m.team_b_id : m.pair_b_id);
  const nextPending = allMatches
    .filter((m) => m.status === "pending")
    .filter((m) => !(aId(m) == null && bId(m) == null))
    .sort((a, b) => {
      const ap = a.queue_position ?? a.match_number;
      const bp = b.queue_position ?? b.match_number;
      return ap - bp;
    })
    .slice(0, 6);

  // Recent results (kept below)
  const recent = allMatches
    .filter((m) => m.status === "completed")
    .sort((a, b) => b.match_number - a.match_number)
    .slice(0, 5);

  const renderStandingsRow = (s: StandingRow, i: number, opts?: { showWDL?: boolean }) => {
    const c = competitorMap.get(s.competitorId) ?? (teamMap.get(s.competitorId)
      ? { id: s.competitorId, name: teamMap.get(s.competitorId)!.name, color: teamMap.get(s.competitorId)!.color }
      : undefined);
    return (
      <tr
        key={s.competitorId}
        className={
          i === 0
            ? "font-semibold text-foreground"
            : "text-muted-foreground"
        }
      >
        <td className="py-1.5 tabular-nums text-xs">{i + 1}</td>
        <td className="py-1.5">
          <div className="flex items-center gap-1.5 min-w-0">
            {i === 0 && <Trophy className="h-3 w-3 text-yellow-500 shrink-0" />}
            {c?.color && (
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{ backgroundColor: c.color }}
              />
            )}
            <span className="truncate">{c?.name ?? "—"}</span>
          </div>
          {c?.subtitle && (
            <div className="text-[10px] text-muted-foreground pl-4 truncate font-normal">
              {c.subtitle}
            </div>
          )}
        </td>
        <td className="py-1.5 text-center tabular-nums">{s.played}</td>
        {opts?.showWDL && (
          <td className="py-1.5 text-center tabular-nums text-xs">
            {s.wins}-{s.draws}-{s.losses}
          </td>
        )}
        <td className="py-1.5 text-center tabular-nums font-bold text-foreground">
          {s.leaguePoints}
        </td>
      </tr>
    );
  };

  const standingsTableHeader = (showWDL: boolean) => (
    <thead>
      <tr className="border-b text-xs text-muted-foreground">
        <th className="pb-2 font-normal text-left w-6">#</th>
        <th className="pb-2 font-normal text-left">ชื่อ</th>
        <th className="pb-2 font-normal text-center w-9">P</th>
        {showWDL && <th className="pb-2 font-normal text-center w-14">W-D-L</th>}
        <th className="pb-2 font-normal text-center w-11">Pts</th>
      </tr>
    </thead>
  );

  return (
    <div className="space-y-5 sm:space-y-6">
      {/* Section 1 — Team total scores */}
      {teamTotalsPlayed.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold">คะแนนรวมทีม</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <table className="w-full text-sm">
              {standingsTableHeader(true)}
              <tbody>
                {teamTotalsPlayed.map((s, i) => renderStandingsRow(s, i, { showWDL: true }))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {/* Section 2 — Pair standings (pair mode only) */}
      {unit === "pair" && pairStandingsAll.some((s) => s.played > 0) && (
        thresholds.length > 0 ? (
          <div className="grid gap-4 md:grid-cols-2">
            {Array.from({ length: N }, (_, i) => i + 1).map((div) => {
              const tone = divisionTone(div);
              const rows = (divisionBuckets.get(div) ?? []).filter((s) => s.played > 0);
              return (
                <Card key={div} className={`border ${tone.border}`}>
                  <CardHeader className="pb-2">
                    <CardTitle className={`text-base font-semibold ${tone.text}`}>
                      {divisionLabelTh(div)}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0">
                    {rows.length > 0 ? (
                      <table className="w-full text-sm">
                        {standingsTableHeader(false)}
                        <tbody>
                          {rows.map((s, i) => renderStandingsRow(s, i))}
                        </tbody>
                      </table>
                    ) : (
                      <p className="text-sm text-muted-foreground py-2">ยังไม่มีผล</p>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        ) : (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-semibold">อันดับคู่</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <table className="w-full text-sm">
                {standingsTableHeader(false)}
                <tbody>
                  {pairStandingsAll
                    .filter((s) => s.played > 0)
                    .map((s, i) => renderStandingsRow(s, i))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        )
      )}

      {/* Section 3 — Queue */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base font-semibold">
            {inProgress.length > 0 && (
              <span className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-500 opacity-75" />
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500" />
              </span>
            )}
            ตารางคิว
          </CardTitle>
        </CardHeader>
        <CardContent className="divide-y pt-0">
          {inProgress.length === 0 && nextPending.length === 0 ? (
            <p className="text-sm text-muted-foreground py-3">ยังไม่มีคิว</p>
          ) : (
            <>
              {inProgress.map((m) => (
                <div key={m.id} className="bg-green-500/5">
                  <MatchRow
                    match={m}
                    competitorById={competitorMap}
                    tournamentId={tournament.id}
                    isOwner={false}
                    unit={unit}
                    size="comfortable"
                  />
                </div>
              ))}
              {nextPending.map((m) => (
                <MatchRow
                  key={m.id}
                  match={m}
                  competitorById={competitorMap}
                  tournamentId={tournament.id}
                  isOwner={false}
                  unit={unit}
                  size="comfortable"
                />
              ))}
            </>
          )}
        </CardContent>
      </Card>

      {/* Recent results — kept below */}
      {recent.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold">ผลล่าสุด</CardTitle>
          </CardHeader>
          <CardContent className="divide-y pt-0">
            {recent.map((m) => (
              <MatchRow
                key={m.id}
                match={m}
                competitorById={competitorMap}
                tournamentId={tournament.id}
                isOwner={false}
                unit={unit}
                size="comfortable"
              />
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
