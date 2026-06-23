"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "@bprogress/next/app";
import { useTranslations } from "next-intl";
import { Loader2, Download } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { computeClubCostRows, formatHours } from "@/lib/club/cost-summary";
import { generateClubCostCsv } from "@/lib/club/cost-csv";
import { downloadCsv } from "@/lib/export/csv";
import { updateClubPlayerDiscountAction } from "@/lib/actions/club-players";
import type { Club, ClubMatch, ClubPlayer } from "@/lib/types";
import type { ClubExpense } from "@/lib/actions/club-cost";

type Props = {
  club: Club;
  players: ClubPlayer[];
  matches: ClubMatch[];
  expenses: ClubExpense[];
  canManage: boolean;
  clubId: string;
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
  const t = useTranslations("club.costBreakdown");

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
      <p className="text-sm text-muted-foreground">{t("notConfigured")}</p>
    );
  }

  if (players.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">{t("noPlayers")}</p>
    );
  }

  // Map playerId → display_name
  const nameById = new Map<string, string>(
    players.map((p) => [p.id, p.display_name])
  );

  // Per-player cost + usage rows via the shared builder — this table, the dashboard
  // table and the CSV export all render from the SAME source so they can't drift
  // (cost-summary.ts). `row.shuttle` = shuttle cost, `row.shuttles` = physical count.
  const { rows, totalCourt, totalShuttle, totalExp, totalDiscount, grandTotal, totalShuttlesUsed } =
    computeClubCostRows({ club, players, matches, expenses });

  const tCostCsv = useTranslations("club");

  const costCsvLabels = {
    colPlayer: tCostCsv("costCsv.colPlayer"),
    colHours: tCostCsv("costCsv.colHours"),
    colGames: tCostCsv("costCsv.colGames"),
    colShuttlesUsed: tCostCsv("costCsv.colShuttlesUsed"),
    colCourtFee: tCostCsv("costCsv.colCourtFee"),
    colShuttleFee: tCostCsv("costCsv.colShuttleFee"),
    colExpense: tCostCsv("costCsv.colExpense"),
    colDiscount: tCostCsv("costCsv.colDiscount"),
    colTotal: tCostCsv("costCsv.colTotal"),
    grandTotal: tCostCsv("costCsv.grandTotal"),
  };

  function handleExport() {
    const csv = generateClubCostCsv({ club, players, matches, expenses }, costCsvLabels);
    const datePart = club.play_date ? `-${club.play_date}` : "";
    downloadCsv(csv, `${tCostCsv("costCsv.filenamePrefix")}-${club.name}${datePart}.csv`);
  }

  const SPLIT_LABEL: Record<string, string> = {
    even: t("splitEven"),
    by_time: t("splitByTime"),
  };

  const SHUTTLE_SPLIT_LABEL: Record<string, string> = {
    even: t("splitEven"),
    per_match: t("splitPerShuttle"),
    per_player: t("splitPerMatch"),
    by_time: t("splitByHour"),
  };

  const GAP_LABEL: Record<string, string> = {
    spread: t("gapSpread"),
    owner: t("gapOwner"),
    ignore: t("gapIgnore"),
  };

  const splitDesc = [
    hasCourt
      ? t("descCourtFee", { fee: club.court_fee.toLocaleString(), split: SPLIT_LABEL[club.court_split] ?? club.court_split })
      : null,
    club.court_split === "by_time"
      ? t("descGap", { gap: GAP_LABEL[club.court_gap_policy] ?? club.court_gap_policy })
      : null,
    hasShuttle
      ? t("descShuttle", { price: club.shuttle_price.toLocaleString(), split: SHUTTLE_SPLIT_LABEL[club.shuttle_split] ?? club.shuttle_split })
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
          {t("exportCsv")}
        </Button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-muted-foreground text-xs">
              <th className="text-left py-1.5 pr-3 font-medium">{t("colPlayer")}</th>
              <th className="text-right py-1.5 px-2 font-medium tabular-nums">{t("colHours")}</th>
              <th className="text-right py-1.5 px-2 font-medium tabular-nums">{t("colGames")}</th>
              <th className="text-right py-1.5 px-2 font-medium tabular-nums">{t("colShuttlesUsed")}</th>
              {hasCourt && (
                <th className="text-right py-1.5 px-2 font-medium tabular-nums">
                  {t("colCourtFee")}
                </th>
              )}
              {hasShuttle && (
                <th className="text-right py-1.5 px-2 font-medium tabular-nums">
                  {t("colShuttleFee")}
                </th>
              )}
              <th className="text-right py-1.5 px-2 font-medium tabular-nums">
                {t("colExpense")}
              </th>
              <th className="text-right py-1.5 px-2 font-medium tabular-nums">
                {t("colDiscount")}
              </th>
              <th className="text-right py-1.5 pl-2 font-medium tabular-nums">
                {t("colTotal")}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              return (
                <tr key={row.playerId} className="border-b last:border-0">
                  <td className="py-1.5 pr-3 font-medium">
                    {nameById.get(row.playerId) ?? row.playerId}
                  </td>
                  <td className="py-1.5 px-2 text-right tabular-nums text-muted-foreground">
                    {formatHours(row.hours)}
                  </td>
                  <td className="py-1.5 px-2 text-right tabular-nums text-muted-foreground">
                    {row.games}
                  </td>
                  <td className="py-1.5 px-2 text-right tabular-nums text-muted-foreground">
                    {row.shuttles}
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
                    {row.expense.toLocaleString()}
                  </td>
                  <DiscountCell
                    clubId={clubId}
                    playerId={row.playerId}
                    initialDiscount={row.discount}
                    canManage={canManage}
                  />
                  <td className="py-1.5 pl-2 text-right font-semibold tabular-nums">
                    {row.total.toLocaleString()}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t-2 font-semibold">
              <td className="py-1.5 pr-3 text-sm">{t("footerLabel")}</td>
              <td className="py-1.5 px-2" aria-hidden />
              <td className="py-1.5 px-2" aria-hidden />
              <td className="py-1.5 px-2 text-right tabular-nums text-sm">
                {totalShuttlesUsed.toLocaleString()}
              </td>
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
