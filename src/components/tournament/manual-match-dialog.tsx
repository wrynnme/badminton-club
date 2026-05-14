"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Plus, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createManualMatchAction } from "@/lib/actions/matches";
import type { PairWithPlayers } from "@/lib/types";

function pairDivision(
  level: string | null | undefined,
  threshold: number | null
): "upper" | "lower" | null {
  if (threshold === null) return null;
  const n = parseFloat(level ?? "");
  return !isNaN(n) && n > threshold ? "upper" : "lower";
}

function pairLabel(pair: PairWithPlayers): string {
  const players = [pair.player1?.display_name, pair.player2?.display_name]
    .filter(Boolean)
    .join(" / ");
  return pair.display_pair_name ?? (players || pair.id.slice(0, 6));
}

export function ManualMatchDialog({
  tournamentId,
  pairs,
  pairDivisionThreshold,
}: {
  tournamentId: string;
  pairs: PairWithPlayers[];
  pairDivisionThreshold: number | null;
}) {
  const [open, setOpen] = useState(false);
  const [pairAId, setPairAId] = useState<string>("");
  const [pairBId, setPairBId] = useState<string>("");
  const [isPending, startTransition] = useTransition();

  const pairA = pairs.find((p) => p.id === pairAId);
  const divA = pairA
    ? pairDivision(pairA.pair_level, pairDivisionThreshold)
    : undefined;

  const pairBOptions = pairAId
    ? pairs.filter(
        (p) =>
          p.id !== pairAId &&
          pairDivision(p.pair_level, pairDivisionThreshold) === divA
      )
    : [];

  const canSubmit = !!pairAId && !!pairBId;

  const handleSubmit = () => {
    if (!canSubmit) return;
    startTransition(async () => {
      const res = await createManualMatchAction({ tournamentId, pairAId, pairBId });
      if ("error" in res) { toast.error(res.error); return; }
      toast.success("สร้างแมตช์แล้ว");
      setOpen(false);
      setPairAId("");
      setPairBId("");
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" variant="outline" />}>
        <Plus className="h-3.5 w-3.5" />
        เพิ่มแมตช์
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>เพิ่มแมตช์</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">คู่ A</label>
            <Select
              value={pairAId}
              onValueChange={(v) => { setPairAId(v ?? ""); setPairBId(""); }}
            >
              <SelectTrigger className="w-full">
                <span className={pairAId ? "" : "text-muted-foreground"}>
                  {pairAId ? pairLabel(pairs.find((p) => p.id === pairAId)!) : "เลือกคู่ A"}
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
            <label className="text-sm font-medium">คู่ B</label>
            <Select
              value={pairBId}
              onValueChange={(v) => setPairBId(v ?? "")}
              disabled={!pairAId}
            >
              <SelectTrigger className="w-full">
                <span className={pairBId ? "" : "text-muted-foreground"}>
                  {pairBId
                    ? pairLabel(pairBOptions.find((p) => p.id === pairBId)!)
                    : pairAId ? "เลือกคู่ B" : "เลือกคู่ A ก่อน"}
                </span>
              </SelectTrigger>
              <SelectContent>
                {pairBOptions.length === 0 ? (
                  <SelectItem value="__none__" disabled>
                    ไม่มีคู่ใน division เดียวกัน
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
            {isPending ? "กำลังสร้าง..." : "สร้างแมตช์"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
