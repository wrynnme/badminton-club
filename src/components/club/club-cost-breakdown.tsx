import { computeClubSplit } from "@/lib/club/cost-split";
import type { Club, ClubMatch, ClubPlayer } from "@/lib/types";

type Props = {
  club: Club;
  players: ClubPlayer[];
  matches: ClubMatch[];
};

const SPLIT_LABEL: Record<string, string> = {
  even: "หารเท่า",
  by_time: "ตามเวลา",
  by_games: "ตามเกม",
  per_match: "หารตามแมตช์",
};

const GAP_LABEL: Record<string, string> = {
  spread: "เฉลี่ยทุกคน",
  owner: "เจ้าของจ่าย",
  ignore: "ไม่คิด",
};

export function ClubCostBreakdown({ club, players, matches }: Props) {
  // per_match mode: shuttle_fee can be 0; cost comes from shuttle_price × shuttles
  const hasShuttle =
    club.shuttle_fee > 0 ||
    (club.shuttle_split === "per_match" && club.shuttle_price > 0);
  const hasCourt = club.court_fee > 0;

  if (!hasCourt && !hasShuttle) {
    return (
      <p className="text-sm text-muted-foreground">ยังไม่ได้ตั้งค่าใช้จ่าย</p>
    );
  }

  if (players.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">ยังไม่มีผู้เล่น</p>
    );
  }

  // Map playerId → display_name
  const nameById = new Map<string, string>(
    players.map((p) => [p.id, p.display_name])
  );

  // Resolve ownerId: helper keys by club_players.id, but club.owner_id is a profile_id
  const ownerPlayerId = players.find((p) => p.profile_id === club.owner_id)?.id;

  // Build SplitMatch array from in_progress / completed matches
  const splitMatches = matches
    .filter((m) => m.status === "in_progress" || m.status === "completed")
    .map((m) => ({
      playerIds: [
        m.side_a_player1,
        m.side_a_player2,
        m.side_b_player1,
        m.side_b_player2,
      ].filter((id): id is string => Boolean(id)),
      shuttles: m.shuttles_used,
    }));

  const rows = computeClubSplit({
    players: players.map((p) => ({
      id: p.id,
      start: p.start_time ?? club.start_time,
      end: p.end_time ?? club.end_time,
      games: p.games_played,
    })),
    courtFee: club.court_fee,
    courtSplit: club.court_split,
    shuttleFee: club.shuttle_fee,
    shuttleSplit: club.shuttle_split,
    shuttlePrice: club.shuttle_price,
    matches: splitMatches,
    sessionStart: club.start_time,
    sessionEnd: club.end_time,
    gapPolicy: club.court_gap_policy,
    ownerId: ownerPlayerId,
  });

  // Footer sums from actual rows (correct under gapPolicy="ignore" which under-collects)
  const totalCourt = rows.reduce((s, r) => s + r.court, 0);
  const totalShuttle = rows.reduce((s, r) => s + r.shuttle, 0);
  const grandTotal = rows.reduce((s, r) => s + r.total, 0);

  const splitDesc = [
    hasCourt
      ? `ค่าสนาม ${club.court_fee.toLocaleString()} ฿ · ${SPLIT_LABEL[club.court_split] ?? club.court_split}`
      : null,
    club.court_split === "by_time"
      ? `ช่วงว่าง: ${GAP_LABEL[club.court_gap_policy] ?? club.court_gap_policy}`
      : null,
    hasShuttle
      ? club.shuttle_split === "per_match"
        ? `ค่าลูก ${club.shuttle_price.toLocaleString()} ฿/ลูก · หารตามแมตช์`
        : `ค่าลูก ${club.shuttle_fee.toLocaleString()} ฿ · ${SPLIT_LABEL[club.shuttle_split] ?? club.shuttle_split}`
      : null,
  ]
    .filter(Boolean)
    .join("  ·  ");

  return (
    <div className="space-y-2">
      {splitDesc && (
        <p className="text-xs text-muted-foreground">{splitDesc}</p>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-muted-foreground text-xs">
              <th className="text-left py-1.5 pr-3 font-medium">ผู้เล่น</th>
              {hasCourt && (
                <th className="text-right py-1.5 px-2 font-medium tabular-nums">
                  ค่าสนาม
                </th>
              )}
              {hasShuttle && (
                <th className="text-right py-1.5 px-2 font-medium tabular-nums">
                  ค่าลูก
                </th>
              )}
              <th className="text-right py-1.5 pl-2 font-medium tabular-nums">
                รวม
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.playerId} className="border-b last:border-0">
                <td className="py-1.5 pr-3 font-medium">
                  {nameById.get(row.playerId) ?? row.playerId}
                </td>
                {hasCourt && (
                  <td className="py-1.5 px-2 text-right tabular-nums">
                    {row.court.toLocaleString()}
                  </td>
                )}
                {hasShuttle && (
                  <td className="py-1.5 px-2 text-right tabular-nums">
                    {row.shuttle.toLocaleString()}
                  </td>
                )}
                <td className="py-1.5 pl-2 text-right font-semibold tabular-nums">
                  {row.total.toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 font-semibold">
              <td className="py-1.5 pr-3 text-sm">รวมทั้งหมด</td>
              {hasCourt && (
                <td className="py-1.5 px-2 text-right tabular-nums text-sm">
                  {totalCourt.toLocaleString()}
                </td>
              )}
              {hasShuttle && (
                <td className="py-1.5 px-2 text-right tabular-nums text-sm">
                  {totalShuttle.toLocaleString()}
                </td>
              )}
              <td className="py-1.5 pl-2 text-right tabular-nums text-sm">
                {grandTotal.toLocaleString()} ฿
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
