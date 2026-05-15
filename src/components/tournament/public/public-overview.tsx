import { Trophy } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MatchRow } from "@/components/tournament/match-row";
import { buildCompetitorMap } from "@/lib/tournament/competitor";
import { computeStandings } from "@/lib/tournament/scoring";
import type { Tournament, TeamWithPlayers, PairWithPlayers, Match, Team } from "@/lib/types";

export function PublicOverview({
  tournament,
  teams,
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

  const inProgress = allMatches.filter((m) => m.status === "in_progress");
  const recent = allMatches
    .filter((m) => m.status === "completed")
    .sort((a, b) => b.match_number - a.match_number)
    .slice(0, 5);

  const ids =
    unit === "team" ? flatTeams.map((t) => t.id) : pairs.map((p) => p.id);
  const standings = computeStandings(allMatches, unit, ids)
    .filter((s) => s.played > 0)
    .slice(0, 6);

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

  return (
    <div className="space-y-5 sm:space-y-6">
      {/* In-progress — highlighted card */}
      {inProgress.length > 0 && (
        <Card className="ring-2 ring-green-500/30 shadow-md shadow-green-500/5">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base font-semibold">
              <span className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-500 opacity-75" />
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500" />
              </span>
              กำลังเล่นอยู่
            </CardTitle>
          </CardHeader>
          <CardContent className="divide-y pt-0">
            {inProgress.map((m) => (
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

      {/* Standings + Recent results */}
      {(standings.length > 0 || recent.length > 0) && (
        <div className="grid gap-4 lg:grid-cols-2">
          {standings.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base font-semibold">อันดับ</CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-xs text-muted-foreground">
                      <th className="pb-2 font-normal text-left w-6">#</th>
                      <th className="pb-2 font-normal text-left">ชื่อ</th>
                      <th className="pb-2 font-normal text-center w-9">P</th>
                      <th className="pb-2 font-normal text-center w-11">Pts</th>
                    </tr>
                  </thead>
                  <tbody>
                    {standings.map((s, i) => {
                      const c = competitorMap.get(s.competitorId);
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
                              {i === 0 && (
                                <Trophy className="h-3 w-3 text-yellow-500 shrink-0" />
                              )}
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
                          <td className="py-1.5 text-center tabular-nums font-bold text-foreground">
                            {s.leaguePoints}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}

          {recent.length > 0 && (
            <Card className={standings.length === 0 ? "lg:col-span-2" : ""}>
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
      )}

      {/* Pending — no results yet but matches exist */}
      {inProgress.length === 0 && recent.length === 0 && allMatches.length > 0 && (
        <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
          <Trophy className="h-12 w-12 mb-3 opacity-25" />
          <p className="text-base font-medium">รอเริ่มแข่งขัน</p>
          <p className="text-sm mt-1">มี {allMatches.length} คู่แข่งขัน</p>
        </div>
      )}
    </div>
  );
}
