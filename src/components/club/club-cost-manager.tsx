"use client";

import { useState, useTransition } from "react";
import { useRouter } from "@bprogress/next/app";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Save, Loader2, ChevronDown } from "lucide-react";
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
import type { CourtSplit, ShuttleSplit, GapPolicy } from "@/lib/types";

type Props = {
  clubId: string;
  initial: {
    court_fee: number;
    court_split: CourtSplit;
    shuttle_split: ShuttleSplit;
    shuttle_price: number;
    court_gap_policy: GapPolicy;
  };
};

export function ClubCostManager({ clubId, initial }: Props) {
  const t = useTranslations("club.costManager");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(true);

  const [courtFee, setCourtFee] = useState(initial.court_fee);
  const [courtSplit, setCourtSplit] = useState<CourtSplit>(initial.court_split);
  const [shuttleSplit, setShuttleSplit] = useState<ShuttleSplit>(initial.shuttle_split);
  const [shuttlePrice, setShuttlePrice] = useState(initial.shuttle_price);
  const [gapPolicy, setGapPolicy] = useState<GapPolicy>(initial.court_gap_policy);

  function handleSave() {
    startTransition(async () => {
      const res = await updateClubCostConfigAction(clubId, {
        court_fee: courtFee,
        court_split: courtSplit,
        shuttle_split: shuttleSplit,
        shuttle_price: shuttlePrice,
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
      <Collapsible open={open} onOpenChange={setOpen}>
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
            {t("shuttleNote")}{" "}
            {shuttleSplit === "even"
              ? t("shuttleDescEven")
              : shuttleSplit === "per_match"
                ? t("shuttleDescPerShuttle")
                : t("shuttleDescPerMatch")}
          </p>
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
