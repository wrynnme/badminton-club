"use client";

import { useState, useTransition } from "react";
import { useRouter } from "@bprogress/next/app";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Save, Loader2, ChevronDown, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { NumberInput } from "@/components/ui/number-input";
import { Label } from "@/components/ui/label";
import { updateClubCostConfigAction } from "@/lib/actions/club-cost";
import type { HourlyShuttleSlot } from "@/lib/club/cost-summary";
import type { CourtSplit, ShuttleSplit, GapPolicy } from "@/lib/types";

type Props = {
  clubId: string;
  initial: {
    court_fee: number;
    court_split: CourtSplit;
    shuttle_split: ShuttleSplit;
    shuttle_price: number;
    shuttle_hourly: number[];
    shuttle_total: number;
    court_gap_policy: GapPolicy;
  };
  /** 1-hour session slots (label + headcount) for the by_time shuttle-count input. */
  hourlySlots: HourlyShuttleSlot[];
};

export function ClubCostManager({ clubId, initial, hourlySlots }: Props) {
  const t = useTranslations("club.costManager");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);

  const [courtFee, setCourtFee] = useState(initial.court_fee);
  const [courtSplit, setCourtSplit] = useState<CourtSplit>(initial.court_split);
  const [shuttleSplit, setShuttleSplit] = useState<ShuttleSplit>(initial.shuttle_split);
  const [shuttlePrice, setShuttlePrice] = useState(initial.shuttle_price);
  // Manual total shuttle count for the "even" split (0 = derive from games played).
  const [shuttleTotal, setShuttleTotal] = useState(initial.shuttle_total);
  const [gapPolicy, setGapPolicy] = useState<GapPolicy>(initial.court_gap_policy);
  // Per-hour shuttle counts, indexed by slot. Held dense over hourlySlots so the
  // total + save payload never hit a sparse-array NaN if the session window changes.
  const [shuttleHourly, setShuttleHourly] = useState<number[]>(() =>
    hourlySlots.map((_, i) => initial.shuttle_hourly[i] ?? 0),
  );
  const setHourlyAt = (i: number, v: number) =>
    setShuttleHourly((prev) =>
      hourlySlots.map((_, k) => (k === i ? Math.max(0, Math.floor(v || 0)) : prev[k] ?? 0)),
    );
  const hourlyTotal = hourlySlots.reduce((sum, _, i) => sum + (shuttleHourly[i] ?? 0), 0);

  function handleSave() {
    startTransition(async () => {
      const res = await updateClubCostConfigAction(clubId, {
        court_fee: courtFee,
        court_split: courtSplit,
        shuttle_split: shuttleSplit,
        shuttle_price: shuttlePrice,
        // Empty slots (invalid window) → keep stored counts rather than wiping them.
        shuttle_hourly: hourlySlots.length
          ? hourlySlots.map((_, i) => shuttleHourly[i] ?? 0)
          : initial.shuttle_hourly,
        shuttle_total: Math.min(9999, Math.max(0, Math.floor(shuttleTotal || 0))),
        court_gap_policy: gapPolicy,
      });
      if (res && "error" in res) {
        toast.error(res.error);
      } else {
        toast.success(t("toastSaved"));
        router.refresh();
      }
    });
  }

  return (
    <Card>
      <Collapsible open={open} onOpenChange={setOpen} className="space-y-2">
        <CardHeader>
          <CollapsibleTrigger
            render={
              <button
                type="button"
                className="flex w-full items-center gap-1.5 text-left font-heading text-base leading-snug font-medium"
              />
            }
          >
            {t("title")}
            <ChevronDown
              className={`ml-auto h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 ${open ? "" : "-rotate-90"}`}
            />
          </CollapsibleTrigger>
        </CardHeader>
        <CollapsibleContent>
          <CardContent className="space-y-5">
            {/* Court fee */}
        <div className="space-y-2">
          <Label className="text-sm font-medium">{t("courtFeeLabel")}</Label>
          <div className="relative max-w-[140px]">
            <NumberInput
              min={0}
              step={1}
              value={courtFee}
              onValueChange={setCourtFee}
              className="pr-8 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            />
            <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">
              ฿
            </span>
          </div>
          <div className="flex gap-1.5">
            <Button
              type="button"
              size="sm"
              variant={courtSplit === "even" ? "default" : "outline"}
              onClick={() => setCourtSplit("even")}
              className="h-7 text-xs"
            >
              {t("splitEven")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant={courtSplit === "by_time" ? "default" : "outline"}
              onClick={() => setCourtSplit("by_time")}
              className="h-7 text-xs"
            >
              {t("splitByTime")}
            </Button>
          </div>
        </div>

        {/* Gap policy — only visible when court_split === "by_time" */}
        {courtSplit === "by_time" && (
          <div className="space-y-2 pl-3 border-l-2 border-muted">
            <Label className="text-sm font-medium">{t("gapSectionLabel")}</Label>
            <div className="flex flex-wrap gap-1.5">
              <Button
                type="button"
                size="sm"
                variant={gapPolicy === "spread" ? "default" : "outline"}
                onClick={() => setGapPolicy("spread")}
                className="h-7 text-xs"
              >
                {t("gapSpread")}
              </Button>
              <Button
                type="button"
                size="sm"
                variant={gapPolicy === "owner" ? "default" : "outline"}
                onClick={() => setGapPolicy("owner")}
                className="h-7 text-xs"
              >
                {t("gapOwner")}
              </Button>
              <Button
                type="button"
                size="sm"
                variant={gapPolicy === "ignore" ? "default" : "outline"}
                onClick={() => setGapPolicy("ignore")}
                className="h-7 text-xs"
              >
                {t("gapIgnore")}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {gapPolicy === "spread"
                ? t("gapDescSpread")
                : gapPolicy === "owner"
                  ? t("gapDescOwner")
                  : t("gapDescIgnore")}
            </p>
          </div>
        )}

        {/* Shuttle fee */}
        <div className="space-y-2">
          <Label className="text-sm font-medium">{t("shuttleFeeLabel")}</Label>
          <div className="relative max-w-[140px]">
            <NumberInput
              min={0}
              step={1}
              value={shuttlePrice}
              onValueChange={setShuttlePrice}
              className="pr-8 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            />
            <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">
              ฿
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Button
              type="button"
              size="sm"
              variant={shuttleSplit === "even" ? "default" : "outline"}
              onClick={() => setShuttleSplit("even")}
              className="h-7 text-xs"
            >
              {t("splitEven")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant={shuttleSplit === "by_time" ? "default" : "outline"}
              onClick={() => setShuttleSplit("by_time")}
              className="h-7 text-xs"
            >
              {t("splitByHour")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant={shuttleSplit === "per_match" ? "default" : "outline"}
              onClick={() => setShuttleSplit("per_match")}
              className="h-7 text-xs"
            >
              {t("splitPerShuttle")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant={shuttleSplit === "per_player" ? "default" : "outline"}
              onClick={() => setShuttleSplit("per_player")}
              className="h-7 text-xs"
            >
              {t("splitPerMatch")}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {shuttleSplit === "by_time" ? (
              t("shuttleDescByHour")
            ) : (
              <>
                {t("shuttleNote")}{" "}
                {shuttleSplit === "even"
                  ? t("shuttleDescEven")
                  : shuttleSplit === "per_match"
                    ? t("shuttleDescPerShuttle")
                    : t("shuttleDescPerMatch")}
              </>
            )}
          </p>

          {/* Manual total shuttle count — only when shuttle_split === "even".
              0 = derive the count from actual games played. */}
          {shuttleSplit === "even" && (
            <div className="space-y-2 pl-3 border-l-2 border-muted">
              <Label className="text-sm font-medium">{t("shuttleEvenCountLabel")}</Label>
              <div className="relative max-w-[140px]">
                <NumberInput
                  min={0}
                  max={9999}
                  step={1}
                  value={shuttleTotal}
                  onValueChange={setShuttleTotal}
                  className="pr-8 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                />
                <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">
                  {t("hourlyUnit")}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">{t("shuttleEvenCountHint")}</p>
            </div>
          )}

          {/* Per-hour shuttle counts — only when shuttle_split === "by_time" */}
          {shuttleSplit === "by_time" && (
            <div className="space-y-2 pl-3 border-l-2 border-muted">
              <div className="flex items-center justify-between gap-2">
                <Label className="text-sm font-medium">{t("hourlyTitle")}</Label>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {t("hourlyTotal", { count: hourlyTotal })}
                </span>
              </div>
              {hourlySlots.length === 0 ? (
                <p className="text-xs text-muted-foreground">{t("hourlyNoSlots")}</p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {hourlySlots.map((slot, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2"
                    >
                      <div className="flex min-w-0 flex-col">
                        <span className="text-xs tabular-nums">{slot.label}</span>
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Users className="h-3 w-3 shrink-0" />
                          {t("hourlyPeople", { count: slot.count })}
                        </span>
                      </div>
                      <div className="relative ml-auto w-[88px] shrink-0">
                        <NumberInput
                          min={0}
                          step={1}
                          value={shuttleHourly[i] ?? 0}
                          onValueChange={(v) => setHourlyAt(i, v)}
                          className="pr-9 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                        />
                        <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">
                          {t("hourlyUnit")}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <Button
          type="button"
          size="sm"
          onClick={handleSave}
          disabled={pending}
        >
          {pending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Save className="h-3.5 w-3.5" />
          )}
          {t("save")}
        </Button>
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
