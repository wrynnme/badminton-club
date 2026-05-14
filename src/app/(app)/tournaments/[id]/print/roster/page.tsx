import { notFound } from "next/navigation";
import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/server";
import { PrintButton } from "@/components/ui/print-button";
import type { Tournament, TeamPlayer } from "@/lib/types";

export const dynamic = "force-dynamic";

type TeamWithPlayers = {
  id: string;
  name: string;
  color: string | null;
  created_at: string;
  players: TeamPlayer[];
};

type RawPair = {
  id: string;
  team_id: string;
  display_pair_name: string | null;
  pair_level: string | null;
  player1: { display_name: string } | null;
  player2: { display_name: string } | null;
};

export default async function PrintRosterPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const sb = await createAdminClient();

  const { data: tournamentData } = await sb
    .from("tournaments")
    .select("*")
    .eq("id", id)
    .single();
  if (!tournamentData) notFound();
  const tournament = tournamentData as Tournament;

  const { data: teamsData } = await sb
    .from("teams")
    .select("*, players:team_players(*)")
    .eq("tournament_id", id)
    .order("created_at");
  const teams: TeamWithPlayers[] = (teamsData ?? []) as unknown as TeamWithPlayers[];

  const teamIdList = teams.map((t) => t.id);

  const pairsRaw: RawPair[] = teamIdList.length
    ? ((
        await sb
          .from("pairs")
          .select(
            "id, team_id, display_pair_name, pair_level, player1:team_players!player_id_1(display_name), player2:team_players!player_id_2(display_name)"
          )
          .in("team_id", teamIdList)
          .order("created_at")
      ).data ?? []) as unknown as RawPair[]
    : [];

  const pairsByTeam = new Map<string, RawPair[]>();
  for (const p of pairsRaw) {
    const list = pairsByTeam.get(p.team_id) ?? [];
    list.push(p);
    pairsByTeam.set(p.team_id, list);
  }

  const isPairMode = tournament.match_unit === "pair";

  return (
    <div className="p-8 max-w-4xl mx-auto font-sans">
      {/* Controls — hidden on print */}
      <div className="mb-6 flex items-center justify-between print:hidden">
        <Link href={`/tournaments/${id}`} className="text-sm underline text-blue-600">
          ← กลับ
        </Link>
        <PrintButton />
      </div>

      <h1 className="text-2xl font-bold mb-1">{tournament.name}</h1>
      <p className="text-sm text-gray-500 mb-6">รายชื่อผู้เล่น</p>

      <div className="space-y-8">
        {teams.map((team) => {
          const teamPairs = pairsByTeam.get(team.id) ?? [];
          const sortedPlayers = [...team.players].sort((a, b) => {
            if (a.role === "captain" && b.role !== "captain") return -1;
            if (b.role === "captain" && a.role !== "captain") return 1;
            return 0;
          });

          return (
            <section key={team.id}>
              {/* Team header */}
              <div className="flex items-center gap-2 mb-2">
                {team.color && (
                  <span
                    className="inline-block w-4 h-4 rounded-sm border border-gray-300 shrink-0"
                    style={{ backgroundColor: team.color }}
                  />
                )}
                <h2 className="text-base font-semibold">{team.name}</h2>
              </div>

              {/* Players */}
              <table className="w-full text-sm border-collapse mb-3">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-1 pr-3 font-semibold">ชื่อ</th>
                    <th className="text-left py-1 pr-3 font-semibold">ตำแหน่ง</th>
                    <th className="text-left py-1 font-semibold">Level</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedPlayers.map((p) => (
                    <tr key={p.id} className="border-b border-gray-100">
                      <td className="py-1 pr-3">{p.display_name}</td>
                      <td className="py-1 pr-3 text-gray-500">
                        {p.role === "captain" ? "กัปตัน" : "สมาชิก"}
                      </td>
                      <td className="py-1">{p.level ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Pairs (pair mode only) */}
              {isPairMode && teamPairs.length > 0 && (
                <div className="ml-2">
                  <p className="text-xs font-semibold text-gray-500 mb-1">คู่:</p>
                  <table className="w-full text-sm border-collapse">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left py-1 pr-3 font-semibold">คู่</th>
                        <th className="text-left py-1 font-semibold">Pair Level</th>
                      </tr>
                    </thead>
                    <tbody>
                      {teamPairs.map((pair) => {
                        const name =
                          pair.display_pair_name ??
                          [pair.player1?.display_name, pair.player2?.display_name]
                            .filter(Boolean)
                            .join(" / ");
                        return (
                          <tr key={pair.id} className="border-b border-gray-100">
                            <td className="py-1 pr-3">{name || "—"}</td>
                            <td className="py-1">{pair.pair_level ?? "—"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          );
        })}

        {teams.length === 0 && (
          <p className="text-sm text-gray-500">ยังไม่มีทีม</p>
        )}
      </div>
    </div>
  );
}
