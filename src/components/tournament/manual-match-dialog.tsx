"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { Plus, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createManualMatchAction } from "@/lib/actions/matches";
import { computePairDivision, parsePairLevel } from "@/lib/tournament/divisions";
import type { PairWithPlayers } from "@/lib/types";

function pairLabel(pair: PairWithPlayers): string {
  const players = [pair.player1?.display_name, pair.player2?.display_name]
    .filter(Boolean)
    .join(" / ");
  return pair.display_pair_name ?? (players || pair.id.slice(0, 6));
}

export function ManualMatchDialog({
  tournamentId,
  pairs,
  pairDivisionThresholds,
}: {
  tournamentId: string;
  pairs: PairWithPlayers[];
  pairDivisionThresholds: number[];
}) {
  const t = useTranslations("tournament");
  const [open, setOpen] = useState(false);
  const [pairAId, setPairAId] = useState<string>("");
  const [pairBId, setPairBId] = useState<string>("");
  const [isPending, startTransition] = useTransition();

  const pairsByDivision = useMemo(() => {
    const map = new Map<number | null, PairWithPlayers[]>();
    for (const p of pairs) {
      const d = computePairDivision(parsePairLevel(p.pair_level), pairDivisionThresholds);
      const arr = map.get(d) ?? [];
      arr.push(p);
      map.set(d, arr);
    }
    return map;
  }, [pairs, pairDivisionThresholds]);

  const pairA = pairs.find((p) => p.id === pairAId);
  const divA = pairA
    ? computePairDivision(parsePairLevel(pairA.pair_level), pairDivisionThresholds)
    : undefined;

  const pairBOptions = pairAId && divA !== undefined
    ? (pairsByDivision.get(divA) ?? []).filter((p) => p.id !== pairAId)
    : [];

  const canSubmit = !!pairAId && !!pairBId;

  const handleSubmit = () => {
    if (!canSubmit) return;
    startTransition(async () => {
      const res = await createManualMatchAction({ tournamentId, pairAId, pairBId });
      if ("error" in res) { toast.error(res.error); return; }
      toast.success(t("manualMatchDialog.toastCreated"));
      setOpen(false);
      setPairAId("");
      setPairBId("");
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" variant="outline" />}>
        <Plus className="h-3.5 w-3.5" />
        {t("manualMatchDialog.btnTrigger")}
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("manualMatchDialog.dialogTitle")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div className="space-y-1.5">
            <Label htmlFor="manual-match-pair-a">{t("manualMatchDialog.labelPairA")}</Label>
            <Select
              value={pairAId}
              onValueChange={(v) => { setPairAId(v ?? ""); setPairBId(""); }}
            >
              <SelectTrigger id="manual-match-pair-a" className="w-full">
                <span className={pairAId ? "" : "text-muted-foreground"}>
                  {pairAId ? pairLabel(pairs.find((p) => p.id === pairAId)!) : t("manualMatchDialog.placeholderA")}
                </span>
              </SelectTrigger>
              <SelectContent>
                {pairs.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {pairLabel(p)}
                    {p.pair_level && (
                      <span className="ml-1.5 text-muted-foreground text-xs">
                        Lv.{p.pair_level}
                      </span>
                    )}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="manual-match-pair-b">{t("manualMatchDialog.labelPairB")}</Label>
            <Select
              value={pairBId}
              onValueChange={(v) => setPairBId(v ?? "")}
              disabled={!pairAId}
            >
              <SelectTrigger id="manual-match-pair-b" className="w-full">
                <span className={pairBId ? "" : "text-muted-foreground"}>
                  {pairBId
                    ? pairLabel(pairBOptions.find((p) => p.id === pairBId)!)
                    : pairAId ? t("manualMatchDialog.placeholderB") : t("manualMatchDialog.placeholderSelectAFirst")}
                </span>
              </SelectTrigger>
              <SelectContent>
                {pairBOptions.length === 0 ? (
                  <SelectItem value="__none__" disabled>
                    {divA != null
                      ? t("manualMatchDialog.emptyNoPairsInDiv", { divLabel: t("division", { n: divA }) })
                      : t("manualMatchDialog.emptyNoSameDiv")}
                  </SelectItem>
                ) : (
                  pairBOptions.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {pairLabel(p)}
                      {p.pair_level && (
                        <span className="ml-1.5 text-muted-foreground text-xs">
                          Lv.{p.pair_level}
                        </span>
                      )}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>

          <Button
            className="w-full"
            disabled={!canSubmit || isPending}
            onClick={handleSubmit}
          >
            {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            {isPending ? t("manualMatchDialog.btnCreating") : t("manualMatchDialog.btnCreate")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
