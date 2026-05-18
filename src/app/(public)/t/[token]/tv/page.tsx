import { notFound } from "next/navigation";
import Link from "next/link";
import { Trophy } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/server";
import { TournamentLiveWrapper } from "@/components/tournament/tournament-live-wrapper";
import { TvAutoRefresh } from "@/components/tournament/tv-auto-refresh";
import { TvMatchCard } from "@/components/tournament/tv-match-card";
import { buildCompetitorMap } from "@/lib/tournament/competitor";
import { computeStandings } from "@/lib/tournament/scoring";
import { parseSettings } from "@/lib/tournament/settings";
import type { Tournament, Team, PairWithPlayers, Match } from "@/lib/types";

export const dynamic = "force-dynamic";

const STATUS_TEXT: Record<string, string> = {
  draft: "แบบร่าง",
  registering: "เปิดรับสมัคร",
  ongoing: "กำลังแข่ง",
  completed: "จบแล้ว",
};

export default async function TvDisplayPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const sb = await createAdminClient();

  const { data: tournament } = await sb
    .from("tournaments")
    .select("*")
    .eq("share_token", token)
    .single();

  if (!tournament) notFound();
  const t = tournament as Tournament;

  const teamsRes = await sb
    .from("teams")
    .select("*")
    .eq("tournament_id", t.id)
    .order("created_at");

  const teamIdList = (teamsRes.data ?? []).map((x) => x.id);

  const [pairsRes, matchesRes] = await Promise.all([
    teamIdList.length
      ? sb.from("pairs").select("*, player1:team_players!player_id_1(*), player2:team_players!player_id_2(*)").in("team_id", teamIdList).order("created_at")
      : Promise.resolve({ data: [] }),
    sb.from("matches").select("*").eq("tournament_id", t.id).order("match_number"),
  ]);

  const teams: Team[] = (teamsRes.data ?? []) as Team[];
  const pairs: PairWithPlayers[] = (pairsRes.data ?? []) as unknown as PairWithPlayers[];
  const allMatches: Match[] = (matchesRes.data ?? []) as Match[];

  const unit = t.match_unit;
  const competitorMap = buildCompetitorMap(unit, teams, pairs);

  const upcoming = allMatches
    .filter((m) => m.status !== "completed")
    .sort((a, b) => {
      // in_progress first, then pending; tiebreak match_number
      if (a.status !== b.status) {
        if (a.status === "in_progress") return -1;
        if (b.status === "in_progress") return 1;
      }
      return a.match_number - b.match_number;
    })
    .slice(0, 8);

  const completed = allMatches
    .filter((m) => m.status === "completed")
    .sort((a, b) => b.match_number - a.match_number)
    .slice(0, 6);

  const competitorIds = unit === "team" ? teams.map((x) => x.id) : pairs.map((p) => p.id);
  const standings = computeStandings(allMatches, unit, competitorIds).slice(0, 8);

  const showStandings = standings.some((s) => s.played > 0);
  const settings = parseSettings(t.settings);

  return (
    <TournamentLiveWrapper tournamentId={t.id} isOngoing={t.status === "ongoing"} realtimeEnabled={settings.realtime_enabled}>
      <TvAutoRefresh intervalMs={60_000} />
      <div className="min-h-screen w-full bg-background text-foreground p-4 sm:p-6 lg:p-10 space-y-6 lg:space-y-8">
        {/* Hero */}
        <header className="flex flex-wrap items-center justify-between gap-4 border-b pb-4 lg:pb-6">
          <div className="flex items-center gap-3 lg:gap-4 min-w-0">
            <Trophy className="h-8 w-8 lg:h-12 lg:w-12 2xl:h-16 2xl:w-16 shrink-0" />
            <div className="min-w-0">
              <h1 className="text-3xl lg:text-5xl xl:text-6xl 2xl:text-7xl font-bold truncate">{t.name}</h1>
              {t.venue && (
                <p className="text-base lg:text-2xl 2xl:text-3xl text-muted-foreground truncate">{t.venue}</p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3 lg:gap-4">
            <span className="px-3 py-1 lg:px-4 lg:py-2 rounded-full border text-base lg:text-xl 2xl:text-2xl font-semibold">
              {STATUS_TEXT[t.status] ?? t.status}
            </span>
            <Link
              href={`/t/${token}`}
              className="text-sm lg:text-base 2xl:text-lg text-muted-foreground hover:text-foreground underline"
            >
              ออก TV
            </Link>
          </div>
        </header>

        {allMatches.length === 0 ? (
          <div className="flex items-center justify-center min-h-[60vh]">
            <p className="text-2xl lg:text-4xl 2xl:text-5xl text-muted-foreground">ยังไม่มีการแข่งขัน</p>
          </div>
        ) : (
          <div className="grid gap-6 lg:gap-8 xl:grid-cols-3">
            {/* Upcoming / In progress */}
            <section className="xl:col-span-2 space-y-3 lg:space-y-4">
              <h2 className="text-2xl lg:text-3xl 2xl:text-4xl font-bold">กำลังเล่น / ถัดไป</h2>
              {upcoming.length === 0 ? (
                <p className="text-lg lg:text-2xl 2xl:text-3xl text-muted-foreground">ไม่มีคิวค้าง</p>
              ) : (
                <div className="space-y-3 lg:space-y-4">
                  {upcoming.map((m) => (
                    <TvMatchCard key={m.id} match={m} competitorById={competitorMap} unit={unit} />
                  ))}
                </div>
              )}
            </section>

            {/* Side: standings + recent */}
            <aside className="space-y-6 lg:space-y-8">
              {showStandings && (
                <section className="space-y-3 lg:space-y-4">
                  <h2 className="text-2xl lg:text-3xl 2xl:text-4xl font-bold">อันดับ</h2>
                  <div className="rounded-xl border bg-card p-3 lg:p-5">
                    <table className="w-full text-base lg:text-xl 2xl:text-2xl">
                      <thead>
                        <tr className="text-left text-muted-foreground border-b">
                          <th className="py-1 font-normal w-8">#</th>
                          <th className="py-1 font-normal">ชื่อ</th>
                          <th className="py-1 font-normal text-center w-10">P</th>
                          <th className="py-1 font-normal text-center w-12">Pts</th>
                        </tr>
                      </thead>
                      <tbody>
                        {standings.map((s, i) => {
                          const c = competitorMap.get(s.competitorId);
                          return (
                            <tr key={s.competitorId} className={i === 0 ? "font-bold text-green-600 dark:text-green-400" : ""}>
                              <td className="py-1 tabular-nums">{i + 1}</td>
                              <td className="py-1 truncate max-w-[10rem] lg:max-w-[14rem]">
                                <div className="flex items-center gap-1.5">
                                  {c?.color && <span className="w-2.5 h-2.5 lg:w-3 lg:h-3 rounded-full shrink-0" style={{ backgroundColor: c.color }} />}
                                  <span className="truncate">{c?.name ?? "—"}</span>
                                </div>
                              </td>
                              <td className="py-1 text-center tabular-nums">{s.played}</td>
                              <td className="py-1 text-center tabular-nums font-semibold">{s.leaguePoints}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}

              <section className="space-y-3 lg:space-y-4">
                <h2 className="text-2xl lg:text-3xl 2xl:text-4xl font-bold">จบล่าสุด</h2>
                {completed.length === 0 ? (
                  <p className="text-lg lg:text-2xl 2xl:text-3xl text-muted-foreground">ยังไม่มีผล</p>
                ) : (
                  <div className="space-y-3 lg:space-y-4">
                    {completed.map((m) => (
                      <TvMatchCard key={m.id} match={m} competitorById={competitorMap} unit={unit} />
                    ))}
                  </div>
                )}
              </section>
            </aside>
          </div>
        )}
      </div>
    </TournamentLiveWrapper>
  );
}
