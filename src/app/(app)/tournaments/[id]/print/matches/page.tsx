import { notFound } from "next/navigation";
import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/server";
import { PrintButton } from "@/components/ui/print-button";
import { gameWinner, sumGameScores } from "@/lib/tournament/scoring";
import type { Tournament, Team, Match, PairWithPlayers } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function PrintMatchesPage({
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
    .select("id, name, color")
    .eq("tournament_id", id)
    .order("created_at");
  const teams: Team[] = (teamsData ?? []) as Team[];
  const teamMap = new Map(teams.map((t) => [t.id, t]));

  const teamIdList = teams.map((t) => t.id);

  type RawPair = {
    id: string;
    display_pair_name: string | null;
    player1: { display_name: string } | null;
    player2: { display_name: string } | null;
  };

  const pairsRaw: RawPair[] = teamIdList.length
    ? ((
        await sb
          .from("pairs")
          .select(
            "id, display_pair_name, player1:team_players!player_id_1(display_name), player2:team_players!player_id_2(display_name)"
          )
          .in("team_id", teamIdList)
      ).data ?? []) as unknown as RawPair[]
    : [];

  const pairMap = new Map(pairsRaw.map((p) => [p.id, p]));

  const { data: matchesData } = await sb
    .from("matches")
    .select("*")
    .eq("tournament_id", id)
    .order("match_number");
  const matches: Match[] = (matchesData ?? []) as Match[];

  const groupMatches = matches.filter((m) => m.round_type === "group");
  const knockoutMatches = matches.filter((m) => m.round_type === "knockout");

  function competitorName(teamId: string | null, pairId: string | null): string {
    if (tournament.match_unit === "pair" && pairId) {
      const p = pairMap.get(pairId);
      if (!p) return "—";
      if (p.display_pair_name) return p.display_pair_name;
      const n1 = p.player1?.display_name ?? "";
      const n2 = p.player2?.display_name ?? "";
      return [n1, n2].filter(Boolean).join(" / ") || "—";
    }
    if (teamId) return teamMap.get(teamId)?.name ?? "—";
    return "TBD";
  }

  function scoreDisplay(match: Match): string {
    if (!match.games?.length || match.status !== "completed") return "—";
    const totals = sumGameScores(match.games);
    return `${totals.a}:${totals.b}`;
  }

  function gameDetails(match: Match): string {
    if (!match.games?.length || match.status !== "completed") return "";
    return match.games.map((g) => `${g.a}–${g.b}`).join(", ");
  }

  function winnerName(match: Match): string {
    if (match.status !== "completed" || !match.winner_id) return "—";
    if (tournament.match_unit === "pair") {
      return competitorName(null, match.winner_id);
    }
    return competitorName(match.winner_id, null);
  }

  const MatchTable = ({ matchList }: { matchList: Match[] }) => (
    <table className="w-full text-sm border-collapse">
      <thead>
        <tr className="border-b">
          <th className="text-left py-1 pr-3 font-semibold w-10">#</th>
          <th className="text-left py-1 pr-3 font-semibold">ฝ่าย A</th>
          <th className="text-left py-1 pr-3 font-semibold">ฝ่าย B</th>
          <th className="text-left py-1 pr-3 font-semibold">คะแนนรวม</th>
          <th className="text-left py-1 pr-3 font-semibold">แต่ละเกม</th>
          <th className="text-left py-1 font-semibold">ผู้ชนะ</th>
        </tr>
      </thead>
      <tbody>
        {matchList.map((m) => (
          <tr key={m.id} className="border-b border-gray-100">
            <td className="py-1 pr-3 text-gray-500">{m.match_number}</td>
            <td className="py-1 pr-3">{competitorName(m.team_a_id, m.pair_a_id)}</td>
            <td className="py-1 pr-3">{competitorName(m.team_b_id, m.pair_b_id)}</td>
            <td className="py-1 pr-3 font-mono">{scoreDisplay(m)}</td>
            <td className="py-1 pr-3 text-gray-500 text-xs">{gameDetails(m)}</td>
            <td className="py-1 font-medium">{winnerName(m)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );

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
      <p className="text-sm text-gray-500 mb-6">ผลการแข่งขัน</p>

      {groupMatches.length > 0 && (
        <section className="mb-8">
          <h2 className="text-lg font-semibold mb-3">รอบแบ่งกลุ่ม</h2>
          <MatchTable matchList={groupMatches} />
        </section>
      )}

      {knockoutMatches.length > 0 && (
        <section className="mb-8">
          <h2 className="text-lg font-semibold mb-3">รอบ Knockout</h2>
          <MatchTable matchList={knockoutMatches} />
        </section>
      )}

      {groupMatches.length === 0 && knockoutMatches.length === 0 && (
        <p className="text-sm text-gray-500">ยังไม่มีแมตช์</p>
      )}
    </div>
  );
}
