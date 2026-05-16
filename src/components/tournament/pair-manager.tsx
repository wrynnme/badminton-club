"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Plus, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createPairAction, deletePairAction } from "@/lib/actions/pairs";
import type { TeamWithPlayers, PairWithPlayers } from "@/lib/types";

function CreatePairForm({ teamId, availablePlayers, onDone }: {
  teamId: string;
  availablePlayers: TeamWithPlayers["players"];
  onDone: () => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);

  const toggle = (pid: string) => {
    setSelected((s) => {
      if (s.includes(pid)) return s.filter((id) => id !== pid);
      if (s.length >= 2) return [s[1], pid];
      return [...s, pid];
    });
  };

  const submit = async () => {
    if (selected.length !== 2) { toast.error("เลือก 2 คน"); return; }
    setPending(true);
    const res = await createPairAction({ teamId, playerIds: [selected[0], selected[1]], name: name || undefined });
    setPending(false);
    if (res?.error) toast.error(res.error);
    else { toast.success("จับคู่แล้ว"); setSelected([]); setName(""); onDone(); }
  };

  return (
    <div className="space-y-3 pt-3 border-t">
      <div className="flex gap-2">
        <Input value={name} onChange={(e) => setName(e.target.value)}
          placeholder="ชื่อคู่ (optional)" className="text-sm flex-1" />
      </div>
      <div className="space-y-1">
        <p className="text-xs text-muted-foreground">เลือก 2 คน:</p>
        {availablePlayers.length === 0 ? (
          <p className="text-xs text-muted-foreground italic">ทุกคนถูกจับคู่แล้ว</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {availablePlayers.map((p) => (
              <Button key={p.id} type="button" size="sm"
                variant={selected.includes(p.id) ? "default" : "outline"}
                className="h-7 text-xs px-2"
                onClick={() => toggle(p.id)}>
                {p.role === "captain" && "★ "}{p.display_name}
                {p.level && <Badge variant="secondary" className="ml-1 text-[10px] px-1 py-0">{p.level}</Badge>}
              </Button>
            ))}
          </div>
        )}
      </div>
      <div className="flex gap-2 justify-end">
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>ยกเลิก</Button>
        <Button type="button" size="sm" onClick={submit} disabled={selected.length !== 2 || pending}>
          {pending && <Loader2 className="h-4 w-4 animate-spin" />}
          {pending ? "บันทึก..." : "จับคู่"}
        </Button>
      </div>
    </div>
  );
}

function PairItem({ pair, isOwner, color }: {
  pair: PairWithPlayers;
  isOwner: boolean;
  color?: string | null;
}) {
  const [, startDel] = useTransition();
  const p1 = pair.player1;
  const p2 = pair.player2;
  const names = [p1?.display_name, p2?.display_name].filter(Boolean).join(" / ");
  const levels = [p1?.level, p2?.level].filter(Boolean);

  return (
    <div className="flex items-center gap-2 text-sm py-1 px-2 border rounded">
      {color && <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground font-mono shrink-0">{pair.id.slice(0, 6)}</span>
          {pair.display_pair_name && <span className="font-medium truncate">{pair.display_pair_name}</span>}
          {pair.pair_level && <Badge className="text-[10px] px-1.5 py-0 shrink-0">{pair.pair_level}</Badge>}
        </div>
        <div className="text-xs text-muted-foreground truncate">{names || "—"}</div>
        {levels.length > 0 && (
          <div className="flex gap-1 mt-0.5">
            {levels.map((lv, i) => (
              <Badge key={i} variant="outline" className="text-[10px] px-1 py-0">{lv}</Badge>
            ))}
          </div>
        )}
      </div>
      {isOwner && (
        <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive hover:text-destructive"
          aria-label="ลบคู่"
          onClick={() => startDel(async () => {
            const res = await deletePairAction(pair.id);
            if (res?.error) toast.error(res.error);
          })}>
          <X className="h-3 w-3" />
        </Button>
      )}
    </div>
  );
}

export function PairManager({ team, pairs, isOwner }: {
  team: TeamWithPlayers;
  pairs: PairWithPlayers[];
  isOwner: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const pairedIds = new Set(pairs.flatMap((p) => [p.player_id_1, p.player_id_2].filter(Boolean) as string[]));
  const available = team.players.filter((p) => !pairedIds.has(p.id));

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {team.color && <span className="w-3 h-3 rounded-full" style={{ backgroundColor: team.color }} />}
            <CardTitle className="text-sm">{team.name}</CardTitle>
            <Badge variant="outline" className="text-xs">{pairs.length} คู่ · {available.length} ว่าง</Badge>
          </div>
          {isOwner && !adding && available.length >= 2 && (
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setAdding(true)}>
              <Plus className="h-3 w-3 mr-1" />จับคู่
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {pairs.length === 0 ? (
          <p className="text-xs text-muted-foreground italic">ยังไม่มีคู่</p>
        ) : (
          <div className="space-y-1">
            {pairs.map((p) => (
              <PairItem key={p.id} pair={p} isOwner={isOwner} color={team.color} />
            ))}
          </div>
        )}
        {adding && (
          <CreatePairForm teamId={team.id} availablePlayers={available} onDone={() => setAdding(false)} />
        )}
      </CardContent>
    </Card>
  );
}
