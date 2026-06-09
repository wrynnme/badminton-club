"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "@bprogress/next/app";
import { Loader2, Download } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { computeClubSplit, computeExpenseShares } from "@/lib/club/cost-split";
import { buildClubSplitInput, playerSessionTotal, computePlayerUsage, formatHours } from "@/lib/club/cost-summary";
import { generateClubCostCsv } from "@/lib/club/cost-csv";
import { downloadCsv } from "@/lib/export/csv";
import { updateClubPlayerDiscountAction } from "@/lib/actions/clubs";
import type { Club, ClubMatch, ClubPlayer } from "@/lib/types";
import type { ClubExpense } from "@/lib/actions/clubs";

type Props = {
  club: Club;
  players: ClubPlayer[];
  matches: ClubMatch[];
  expenses: ClubExpense[];
  canManage: boolean;
  clubId: string;
};

const SPLIT_LABEL: Record<string, string> = {
  even: "หารเท่า",
  by_time: "ตามเวลา",
};

// Shuttle split mode labels — match the manager UI (commit 8d9e96c relabel).
const SHUTTLE_SPLIT_LABEL: Record<string, string> = {
  even: "หารเท่า",
  per_match: "ต่อลูก",
  per_player: "ต่อแมตช์",
};

const GAP_LABEL: Record<string, string> = {
  spread: "เฉลี่ยทุกคน",
  owner: "เจ้าของจ่าย",
  ignore: "ไม่คิด",
};

// ─── Editable discount cell (one per player row) ──────────────────────────────

function DiscountCell({
  clubId,
  playerId,
  initialDiscount,
  canManage,
}: {
  clubId: string;
  playerId: string;
  initialDiscount: number;
  canManage: boolean;
}) {
  const router = useRouter();
  const [value, setValue] = useState(initialDiscount);
  const [pending, start] = useTransition();
  const focusedRef = useRef(false);

  // Resync to the latest DB value after an external refresh — unless the field is
  // focused (don't clobber an in-progress edit).
  useEffect(() => {
    if (!focusedRef.current) setValue(initialDiscount);
  }, [initialDiscount]);

  function handleBlur() {
    focusedRef.current = false;
    if (value === initialDiscount) return; // skip unchanged
    start(async () => {
      const res = await updateClubPlayerDiscountAction(clubId, playerId, value);
      if ("error" in res) {
        toast.error(res.error);
        setValue(initialDiscount); // revert on error
      } else {
        router.refresh();
      }
    });
  }

  if (!canManage) {
    return (
      <td className="py-1.5 px-2 text-right tabular-nums">
        {value.toLocaleString()}
      </td>
    );
  }

  return (
    <td className="py-1.5 px-2 text-right tabular-nums">
      <div className="flex items-center justify-end gap-1">
        {pending && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
        <Input
          type="number"
          min={0}
          value={value}
          disabled={pending}
          onChange={(e) => setValue(Math.max(0, parseFloat(e.target.value) || 0))}
          onFocus={() => { focusedRef.current = true; }}
          onBlur={handleBlur}
          className="h-6 w-[72px] text-xs text-right [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none px-1.5"
        />
      </div>
    </td>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function ClubCostBreakdown({
  club,
  players,
  matches,
  expenses,
  canManage,
  clubId,
}: Props) {
  // All three shuttle modes (even/per_match/per_player) are price-driven via
  // computeShuttle (shuttle_price × per-match shuttles_used); shuttle_fee is dead.
  const hasShuttle = club.shuttle_price > 0;
  const hasCourt = club.court_fee > 0;
  // Personal expenses / discounts also warrant the breakdown (their per-player
  // shares feed the grand total even without court/shuttle fees).
  const hasExpense =
    expenses.some((e) => Number(e.amount) > 0) || players.some((p) => p.discount > 0);

  if (!hasCourt && !hasShuttle && !hasExpense) {
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

  // Court + shuttle split — assembled via the shared adapter so this table and
  // the dashboard "ค่าใช้จ่ายรวม" card derive identical numbers (cost-summary.ts).
  const rows = computeClubSplit(buildClubSplitInput(club, players, matches));

  // Per-player presence hours + shuttles used (info columns; same shared helper the
  // CSV export uses, so the table and the download agree).
  const usage = computePlayerUsage({ club, players, matches });

  function handleExport() {
    const csv = generateClubCostCsv({ club, players, matches, expenses });
    const datePart = club.play_date ? `-${club.play_date}` : "";
    downloadCsv(csv, `ค่าใช้จ่าย-${club.name}${datePart}.csv`);
  }

  // Personal expense shares per player
  const expShare = computeExpenseShares(
    players.map((p) => p.id),
    expenses.map((e) => ({
      amount: Number(e.amount),
      payerPlayerIds: e.payer_player_ids,
    }))
  );

  // Build a discount lookup from players (initialised from DB; editable cells manage own state)
  const discountById = new Map<string, number>(
    players.map((p) => [p.id, p.discount ?? 0])
  );

  // Per-player grand total — shared helper so this table and the dashboard card
  // derive the identical figure (cost-summary.ts).
  const playerTotals = rows.map((row) => {
    const exp = expShare.get(row.playerId) ?? 0;
    const disc = discountById.get(row.playerId) ?? 0;
    return playerSessionTotal({ court: row.court, shuttle: row.shuttle, expense: exp, discount: disc });
  });

  // Footer sums from actual row values
  const totalCourt = rows.reduce((s, r) => s + r.court, 0);
  const totalShuttle = rows.reduce((s, r) => s + r.shuttle, 0);
  const totalExp = [...expShare.values()].reduce((s, v) => s + v, 0);
  const totalDiscount = players.reduce((s, p) => s + (p.discount ?? 0), 0);
  const grandTotal = playerTotals.reduce((s, v) => s + v, 0);

  const splitDesc = [
    hasCourt
      ? `ค่าสนาม ${club.court_fee.toLocaleString()} ฿ · ${SPLIT_LABEL[club.court_split] ?? club.court_split}`
      : null,
    club.court_split === "by_time"
      ? `ช่วงว่าง: ${GAP_LABEL[club.court_gap_policy] ?? club.court_gap_policy}`
      : null,
    hasShuttle
      ? `ค่าลูก ${club.shuttle_price.toLocaleString()} ฿/ลูก · ${SHUTTLE_SPLIT_LABEL[club.shuttle_split] ?? club.shuttle_split}`
      : null,
  ]
    .filter(Boolean)
    .join("  ·  ");

  return (
    <div className="space-y-2">
      <div className="flex items-start justify-between gap-2">
        {splitDesc ? (
          <p className="text-xs text-muted-foreground">{splitDesc}</p>
        ) : (
          <span />
        )}
        <Button
          variant="outline"
          size="sm"
          className="h-7 shrink-0 gap-1 text-xs"
          onClick={handleExport}
        >
          <Download className="h-3.5 w-3.5" />
          Export CSV
        </Button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-muted-foreground text-xs">
              <th className="text-left py-1.5 pr-3 font-medium">ผู้เล่น</th>
              <th className="text-right py-1.5 px-2 font-medium tabular-nums">ชม.</th>
              <th className="text-right py-1.5 px-2 font-medium tabular-nums">ลูกที่ใช้</th>
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
              <th className="text-right py-1.5 px-2 font-medium tabular-nums">
                ค่าใช้จ่ายส่วนบุคคล
              </th>
              <th className="text-right py-1.5 px-2 font-medium tabular-nums">
                ส่วนลด
              </th>
              <th className="text-right py-1.5 pl-2 font-medium tabular-nums">
                รวม
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const exp = expShare.get(row.playerId) ?? 0;
              const playerTotal = playerTotals[i];
              return (
                <tr key={row.playerId} className="border-b last:border-0">
                  <td className="py-1.5 pr-3 font-medium">
                    {nameById.get(row.playerId) ?? row.playerId}
                  </td>
                  <td className="py-1.5 px-2 text-right tabular-nums text-muted-foreground">
                    {formatHours((usage.get(row.playerId)?.hours ?? 0))}
                  </td>
                  <td className="py-1.5 px-2 text-right tabular-nums text-muted-foreground">
                    {usage.get(row.playerId)?.shuttles ?? 0}
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
                  <td className="py-1.5 px-2 text-right tabular-nums">
                    {exp.toLocaleString()}
                  </td>
                  <DiscountCell
                    clubId={clubId}
                    playerId={row.playerId}
                    initialDiscount={discountById.get(row.playerId) ?? 0}
                    canManage={canManage}
                  />
                  <td className="py-1.5 pl-2 text-right font-semibold tabular-nums">
                    {playerTotal.toLocaleString()}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t-2 font-semibold">
              <td className="py-1.5 pr-3 text-sm">รวมทั้งหมด</td>
              <td className="py-1.5 px-2" aria-hidden />
              <td className="py-1.5 px-2" aria-hidden />
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
              <td className="py-1.5 px-2 text-right tabular-nums text-sm">
                {totalExp.toLocaleString()}
              </td>
              <td className="py-1.5 px-2 text-right tabular-nums text-sm">
                {totalDiscount.toLocaleString()}
              </td>
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
