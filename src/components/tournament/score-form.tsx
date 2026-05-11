"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { recordMatchScoreAction } from "@/lib/actions/matches";
import type { Game } from "@/lib/types";
import type { Competitor } from "@/lib/tournament/competitor";

export function ScoreForm({
  matchId,
  tournamentId,
  competitorA,
  competitorB,
  initialGames,
  onDone,
}: {
  matchId: string;
  tournamentId: string;
  competitorA: Competitor | undefined;
  competitorB: Competitor | undefined;
  initialGames: Game[];
  onDone: () => void;
}) {
  const [games, setGames] = useState<Game[]>(
    initialGames.length ? initialGames : [{ a: 0, b: 0 }]
  );
  const [pending, setPending] = useState(false);

  const updateGame = (i: number, side: "a" | "b", value: number) => {
    setGames((g) => g.map((gm, idx) => (idx === i ? { ...gm, [side]: Math.max(0, value) } : gm)));
  };
  const addGame = () => setGames((g) => [...g, { a: 0, b: 0 }]);
  const removeGame = (i: number) => setGames((g) => g.filter((_, idx) => idx !== i));

  const submit = async () => {
    setPending(true);
    const res = await recordMatchScoreAction({ matchId, tournamentId, games });
    setPending(false);
    if (res?.error) toast.error(res.error);
    else { toast.success("บันทึกผลแล้ว"); onDone(); }
  };

  return (
    <div className="space-y-3 pt-2 border-t">
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span className="flex-1 text-right truncate">{competitorA?.name ?? "—"}</span>
        <span className="text-muted-foreground">vs</span>
        <span className="flex-1 truncate">{competitorB?.name ?? "—"}</span>
      </div>
      <div className="space-y-1.5">
        {games.map((g, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground w-10">เกม {i + 1}</span>
            <Input
              type="number" min={0} value={g.a}
              onChange={(e) => updateGame(i, "a", Number(e.target.value))}
              className="w-14 text-center [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            />
            <span className="text-muted-foreground">:</span>
            <Input
              type="number" min={0} value={g.b}
              onChange={(e) => updateGame(i, "b", Number(e.target.value))}
              className="w-14 text-center [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            />
            {games.length > 1 && (
              <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => removeGame(i)}>
                <X className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <Button type="button" size="sm" variant="outline" onClick={addGame} className="h-7 text-xs">
          <Plus className="h-3 w-3 mr-1" />เพิ่มเกม
        </Button>
        <div className="flex-1" />
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>ยกเลิก</Button>
        <Button type="button" size="sm" onClick={submit} disabled={pending}>
          {pending ? "บันทึก..." : "บันทึกผล"}
        </Button>
      </div>
    </div>
  );
}
