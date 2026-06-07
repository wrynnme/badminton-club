"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { GripVertical, Minus, Plus, Play, X, Trophy, ChevronDown, ChevronUp, PenLine, Trash2, AlertTriangle } from "lucide-react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  buildNextClubMatchAction,
  startClubMatchAction,
  finishClubMatchAction,
  cancelClubMatchAction,
  setClubMatchShuttlesAction,
  createClubManualMatchAction,
  reorderClubQueueAction,
  deleteClubMatchAction,
} from "@/lib/actions/clubs";
import type { ClubMatch } from "@/lib/types";
import type { ClubQueueSettings } from "@/lib/club/queue-settings";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatElapsed(startedAt: string): string {
  const elapsedMs = Date.now() - new Date(startedAt).getTime();
  if (elapsedMs < 0) return "0:00";
  const totalSec = Math.floor(elapsedMs / 1000);
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function resolveSide(
  player1: string,
  player2: string | null,
  nameMap: Map<string, string>,
): string {
  const n1 = nameMap.get(player1) ?? "—";
  if (!player2) return n1;
  const n2 = nameMap.get(player2) ?? "—";
  return `${n1} / ${n2}`;
}

// ─── Elapsed ticker — updates every second for a single in_progress match ────

function ElapsedTicker({ startedAt }: { startedAt: string }) {
  const [display, setDisplay] = useState("0:00");

  useEffect(() => {
    setDisplay(formatElapsed(startedAt));
    const id = setInterval(() => {
      setDisplay(formatElapsed(startedAt));
    }, 1000);
    return () => clearInterval(id);
  }, [startedAt]);

  return (
    <span className="text-xs tabular-nums text-muted-foreground">{display}</span>
  );
}

// ─── Shuttle counter — compact +/- control ────────────────────────────────────

function ShuttleCounter({
  match,
  canManage,
  onRefresh,
}: {
  match: ClubMatch;
  canManage: boolean;
  onRefresh: () => void;
}) {
  const [busy, startTransition] = useTransition();

  function adjust(delta: number) {
    const next = Math.max(0, match.shuttles_used + delta);
    startTransition(async () => {
      const res = await setClubMatchShuttlesAction(match.id, next);
      if ("error" in res) {
        toast.error(res.error);
      } else {
        onRefresh();
      }
    });
  }

  return (
    <div className="flex items-center gap-1 shrink-0">
      <span className="text-xs text-muted-foreground tabular-nums">
        🏸 {match.shuttles_used}
      </span>
      {canManage && (
        <>
          {match.shuttles_used > 0 && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 w-6 p-0 text-muted-foreground"
                    disabled={busy}
                    onClick={() => adjust(-1)}
                  >
                    <Minus className="h-3 w-3" />
                  </Button>
                }
              />
              <TooltipContent>ลดลูกที่ใช้ในแมตช์นี้</TooltipContent>
            </Tooltip>
          )}
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 px-1.5 text-xs text-muted-foreground"
                  disabled={busy}
                  onClick={() => adjust(1)}
                >
                  +ลูก
                </Button>
              }
            />
            <TooltipContent>เพิ่มลูกที่ใช้ในแมตช์นี้</TooltipContent>
          </Tooltip>
        </>
      )}
    </div>
  );
}

// ─── Delete match confirm dialog ─────────────────────────────────────────────

function DeleteMatchButton({
  matchId,
  status,
  onRefresh,
}: {
  matchId: string;
  status: "in_progress" | "completed";
  onRefresh: () => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();

  function handleConfirm() {
    start(async () => {
      const res = await deleteClubMatchAction(matchId);
      if ("error" in res) {
        toast.error(res.error);
      } else {
        setOpen(false);
        router.refresh();
        toast.success("ลบแมตช์แล้ว");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-destructive hover:text-destructive shrink-0"
            aria-label="ลบแมตช์นี้"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-destructive shrink-0" />
            ลบแมตช์นี้?
          </DialogTitle>
        </DialogHeader>

        <ul className="text-sm text-muted-foreground space-y-1.5 list-disc pl-5">
          <li>แมตช์นี้จะถูกลบถาวร</li>
          {status === "completed" && (
            <li>จำนวนเกม (games) ของผู้เล่นจะถูกนับคืน −1</li>
          )}
          <li>ค่าลูกของแมตช์นี้จะหายจากการหาร</li>
          {status === "in_progress" && (
            <li>สนามจะว่างลง</li>
          )}
          <li>เวลาเล่นล่าสุด + การนับเกมล็อคคู่ จะไม่ถูกคืน</li>
        </ul>

        <DialogFooter>
          <DialogClose render={<Button variant="outline" disabled={pending}>ยกเลิก</Button>} />
          <Button variant="destructive" onClick={handleConfirm} disabled={pending}>
            {pending ? "กำลังลบ…" : "ลบแมตช์"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Pending match row ────────────────────────────────────────────────────────

function PendingRow({
  match,
  nameMap,
  canManage,
  onRefresh,
  dragHandleProps,
  rowNumber,
}: {
  match: ClubMatch;
  nameMap: Map<string, string>;
  canManage: boolean;
  onRefresh: () => void;
  dragHandleProps?: Record<string, unknown> | null;
  rowNumber?: number;
}) {
  const [startBusy, startTransition] = useTransition();
  const [cancelBusy, cancelTransition] = useTransition();

  const sideA = resolveSide(match.side_a_player1, match.side_a_player2, nameMap);
  const sideB = resolveSide(match.side_b_player1, match.side_b_player2, nameMap);

  function handleStart() {
    startTransition(async () => {
      const res = await startClubMatchAction(match.id);
      if ("error" in res) {
        toast.error(res.error);
      } else {
        onRefresh();
      }
    });
  }

  function handleCancel() {
    cancelTransition(async () => {
      const res = await cancelClubMatchAction(match.id);
      if ("error" in res) {
        toast.error(res.error);
      } else {
        onRefresh();
      }
    });
  }

  return (
    <div className="flex items-center gap-2 py-2 border-b last:border-0">
      {dragHandleProps && (
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                {...dragHandleProps}
                aria-label="ลากเพื่อจัดลำดับ"
                className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground touch-none shrink-0"
              >
                <GripVertical className="h-4 w-4" />
              </button>
            }
          />
          <TooltipContent>ลากเพื่อจัดลำดับ</TooltipContent>
        </Tooltip>
      )}
      {rowNumber != null && (
        <span className="text-xs font-mono text-muted-foreground w-5 shrink-0 text-right">
          {rowNumber}.
        </span>
      )}
      <Badge variant="outline" className="shrink-0 text-xs">
        สนาม {match.court}
      </Badge>
      <span className="flex-1 text-sm truncate">
        {sideA} <span className="text-muted-foreground">vs</span> {sideB}
      </span>
      {canManage && (
        <div className="flex items-center gap-1 shrink-0">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  size="sm"
                  variant="default"
                  className="h-7 px-2"
                  disabled={startBusy}
                  onClick={handleStart}
                >
                  <Play className="h-3.5 w-3.5" />
                </Button>
              }
            />
            <TooltipContent>เริ่มแมตช์ที่สนาม {match.court}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-destructive hover:text-destructive"
                  disabled={cancelBusy}
                  onClick={handleCancel}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              }
            />
            <TooltipContent>ยกเลิกแมตช์</TooltipContent>
          </Tooltip>
        </div>
      )}
    </div>
  );
}

// ─── Sortable wrapper for PendingRow ─────────────────────────────────────────

function SortablePendingRow({
  match,
  nameMap,
  onRefresh,
  rowNumber,
}: {
  match: ClubMatch;
  nameMap: Map<string, string>;
  onRefresh: () => void;
  rowNumber: number;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: match.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };

  return (
    <li ref={setNodeRef} style={style} className="touch-none list-none">
      <PendingRow
        match={match}
        nameMap={nameMap}
        canManage
        onRefresh={onRefresh}
        dragHandleProps={{ ...attributes, ...listeners }}
        rowNumber={rowNumber}
      />
    </li>
  );
}

// ─── In-progress match row ────────────────────────────────────────────────────

function InProgressRow({
  match,
  nameMap,
  canManage,
  onRefresh,
}: {
  match: ClubMatch;
  nameMap: Map<string, string>;
  canManage: boolean;
  onRefresh: () => void;
}) {
  const [finishOpen, setFinishOpen] = useState(false);
  const [finishBusy, finishTransition] = useTransition();

  const sideA = resolveSide(match.side_a_player1, match.side_a_player2, nameMap);
  const sideB = resolveSide(match.side_b_player1, match.side_b_player2, nameMap);

  function handleFinish(winnerSide?: "a" | "b") {
    finishTransition(async () => {
      const res = await finishClubMatchAction({
        matchId: match.id,
        winnerSide,
      });
      if ("error" in res) {
        toast.error(res.error);
      } else {
        setFinishOpen(false);
        onRefresh();
      }
    });
  }

  return (
    <div className="py-2 border-b last:border-0">
      <div className="flex items-center gap-2">
        <Badge className="shrink-0 text-xs bg-warning/20 text-warning-foreground border-warning/40">
          สนาม {match.court}
        </Badge>
        <span className="flex-1 text-sm truncate">
          {sideA} <span className="text-muted-foreground">vs</span> {sideB}
        </span>
        {match.started_at && (
          <ElapsedTicker startedAt={match.started_at} />
        )}
        <ShuttleCounter match={match} canManage={canManage} onRefresh={onRefresh} />
        {canManage && (
          <>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 px-2 shrink-0"
                    disabled={finishBusy}
                    onClick={() => setFinishOpen((o) => !o)}
                  >
                    {finishOpen ? (
                      <ChevronUp className="h-3.5 w-3.5" />
                    ) : (
                      <ChevronDown className="h-3.5 w-3.5" />
                    )}
                    <span className="text-xs ml-1">จบแข่ง</span>
                  </Button>
                }
              />
              <TooltipContent>บันทึกผลแมตช์สนาม {match.court}</TooltipContent>
            </Tooltip>
            <DeleteMatchButton matchId={match.id} status="in_progress" onRefresh={onRefresh} />
          </>
        )}
      </div>

      {finishOpen && canManage && (
        <div className="mt-2 ml-2 flex flex-wrap gap-2">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  size="sm"
                  variant="default"
                  className="h-7 text-xs"
                  disabled={finishBusy}
                  onClick={() => handleFinish("a")}
                >
                  <Trophy className="h-3 w-3 mr-1" />
                  ฝั่ง A ชนะ
                </Button>
              }
            />
            <TooltipContent>{sideA} ชนะ</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  size="sm"
                  variant="default"
                  className="h-7 text-xs"
                  disabled={finishBusy}
                  onClick={() => handleFinish("b")}
                >
                  <Trophy className="h-3 w-3 mr-1" />
                  ฝั่ง B ชนะ
                </Button>
              }
            />
            <TooltipContent>{sideB} ชนะ</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs"
                  disabled={finishBusy}
                  onClick={() => handleFinish(undefined)}
                >
                  จบแบบไม่ระบุผล
                </Button>
              }
            />
            <TooltipContent>บันทึกว่าจบโดยไม่มีผู้ชนะ</TooltipContent>
          </Tooltip>
        </div>
      )}
    </div>
  );
}

// ─── Completed match row ──────────────────────────────────────────────────────

function CompletedRow({
  match,
  nameMap,
  canManage,
  onRefresh,
}: {
  match: ClubMatch;
  nameMap: Map<string, string>;
  canManage: boolean;
  onRefresh: () => void;
}) {
  const sideA = resolveSide(match.side_a_player1, match.side_a_player2, nameMap);
  const sideB = resolveSide(match.side_b_player1, match.side_b_player2, nameMap);

  const winnerA = match.winner_side === "a";
  const winnerB = match.winner_side === "b";

  return (
    <div className="flex items-center gap-2 py-2 border-b last:border-0 text-sm text-muted-foreground">
      <Badge variant="outline" className="shrink-0 text-xs opacity-60">
        สนาม {match.court}
      </Badge>
      <span className={winnerA ? "text-winner font-medium" : ""}>{sideA}</span>
      <span className="text-xs">vs</span>
      <span className={winnerB ? "text-winner font-medium" : ""}>{sideB}</span>
      {match.winner_side && (
        <Trophy className="h-3.5 w-3.5 text-warning shrink-0" />
      )}
      <div className="ml-auto flex items-center gap-1">
        <ShuttleCounter match={match} canManage={canManage} onRefresh={onRefresh} />
        {canManage && (
          <DeleteMatchButton matchId={match.id} status="completed" onRefresh={onRefresh} />
        )}
      </div>
    </div>
  );
}

// ─── Per-court build button ───────────────────────────────────────────────────

function BuildButton({
  clubId,
  court,
  onRefresh,
}: {
  clubId: string;
  court: number;
  onRefresh: () => void;
}) {
  const [busy, transition] = useTransition();

  function handleBuild() {
    transition(async () => {
      const res = await buildNextClubMatchAction(clubId, court);
      if ("error" in res) {
        toast.error(res.error);
      } else {
        toast.success(`สร้างแมตช์สนาม ${court} แล้ว`);
        onRefresh();
      }
    });
  }

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            size="sm"
            variant="outline"
            className="h-8 text-xs gap-1"
            disabled={busy}
            onClick={handleBuild}
          >
            <Plus className="h-3.5 w-3.5" />
            สนาม {court}
          </Button>
        }
      />
      <TooltipContent>สร้างแมตช์ถัดไปสำหรับสนาม {court}</TooltipContent>
    </Tooltip>
  );
}

// ─── Player select — module-level to avoid remount on every render ────────────

function PlayerSelect({
  id,
  label,
  value,
  onChange,
  players,
  nameMap,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  players: { id: string; display_name: string }[];
  nameMap: Map<string, string>;
}) {
  function renderName(v: string) {
    return v ? (nameMap.get(v) ?? v) : "เลือกผู้เล่น";
  }

  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </Label>
      <Select value={value} onValueChange={(v) => { if (v) onChange(v); }}>
        <SelectTrigger id={id} className="h-8 text-sm">
          <SelectValue>{(v: string) => renderName(v)}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {players.map((p) => (
            <SelectItem key={p.id} value={p.id}>
              {p.display_name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

// ─── Manual match dialog ──────────────────────────────────────────────────────

const UNSET = "";

function ManualMatchDialog({
  clubId,
  players,
  settings,
  onRefresh,
}: {
  clubId: string;
  players: { id: string; display_name: string }[];
  settings: ClubQueueSettings;
  onRefresh: () => void;
}) {
  const ppt = settings.players_per_team;
  const [open, setOpen] = useState(false);
  const [busy, startTransition] = useTransition();

  const [court, setCourt] = useState(1);
  const [sideA1, setSideA1] = useState(UNSET);
  const [sideA2, setSideA2] = useState(UNSET);
  const [sideB1, setSideB1] = useState(UNSET);
  const [sideB2, setSideB2] = useState(UNSET);

  const nameMap = new Map(players.map((p) => [p.id, p.display_name]));

  function reset() {
    setCourt(1);
    setSideA1(UNSET);
    setSideA2(UNSET);
    setSideB1(UNSET);
    setSideB2(UNSET);
  }

  function handleSubmit() {
    const sideA = ppt === 2 ? [sideA1, sideA2] : [sideA1];
    const sideB = ppt === 2 ? [sideB1, sideB2] : [sideB1];
    const all = [...sideA, ...sideB];

    if (all.some((id) => !id)) {
      toast.error("กรุณาเลือกผู้เล่นให้ครบ");
      return;
    }
    if (new Set(all).size !== all.length) {
      toast.error("ผู้เล่นซ้ำกัน กรุณาเลือกใหม่");
      return;
    }

    startTransition(async () => {
      const res = await createClubManualMatchAction({
        clubId,
        court,
        sideA,
        sideB,
      });
      if ("error" in res) {
        toast.error(res.error);
      } else {
        toast.success("เพิ่มแมตช์แล้ว");
        reset();
        setOpen(false);
        onRefresh();
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <DialogTrigger
        render={
          <Button size="sm" variant="outline" className="h-8 text-xs gap-1">
            <PenLine className="h-3.5 w-3.5" />
            เพิ่มแมตช์เอง
          </Button>
        }
      />
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>เพิ่มแมตช์เอง</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Court number */}
          <div className="space-y-1">
            <Label htmlFor="mm-court" className="text-sm font-medium">
              สนาม
            </Label>
            <Input
              id="mm-court"
              type="number"
              min={1}
              value={court}
              onChange={(e) => setCourt(Math.max(1, Math.trunc(Number(e.target.value)) || 1))}
              className="h-8 w-24 text-sm [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            />
          </div>

          {/* Side A */}
          <div className="space-y-2">
            <p className="text-sm font-medium">ฝั่ง A</p>
            <PlayerSelect
              id="mm-sideA1"
              label={ppt === 2 ? "ผู้เล่น 1" : "ผู้เล่น"}
              value={sideA1}
              onChange={setSideA1}
              players={players}
              nameMap={nameMap}
            />
            {ppt === 2 && (
              <PlayerSelect
                id="mm-sideA2"
                label="ผู้เล่น 2"
                value={sideA2}
                onChange={setSideA2}
                players={players}
                nameMap={nameMap}
              />
            )}
          </div>

          {/* Side B */}
          <div className="space-y-2">
            <p className="text-sm font-medium">ฝั่ง B</p>
            <PlayerSelect
              id="mm-sideB1"
              label={ppt === 2 ? "ผู้เล่น 1" : "ผู้เล่น"}
              value={sideB1}
              onChange={setSideB1}
              players={players}
              nameMap={nameMap}
            />
            {ppt === 2 && (
              <PlayerSelect
                id="mm-sideB2"
                label="ผู้เล่น 2"
                value={sideB2}
                onChange={setSideB2}
                players={players}
                nameMap={nameMap}
              />
            )}
          </div>
        </div>

        <DialogFooter>
          <DialogClose render={<Button variant="outline" disabled={busy}>ยกเลิก</Button>} />
          <Button onClick={handleSubmit} disabled={busy}>
            {busy ? "กำลังสร้าง…" : "เพิ่มแมตช์"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main panel ───────────────────────────────────────────────────────────────

export function ClubQueuePanel({
  clubId,
  matches,
  players,
  settings,
  canManage,
}: {
  clubId: string;
  matches: ClubMatch[];
  players: { id: string; display_name: string }[];
  settings: ClubQueueSettings;
  canManage: boolean;
}) {
  const router = useRouter();
  const [reorderPending, startReorder] = useTransition();

  // Build a stable name-resolution map
  const nameMap = useRef(new Map<string, string>());
  useEffect(() => {
    const m = new Map<string, string>();
    for (const p of players) m.set(p.id, p.display_name);
    nameMap.current = m;
  }, [players]);
  // Also initialise synchronously for SSR/first paint
  if (nameMap.current.size === 0 && players.length > 0) {
    const m = new Map<string, string>();
    for (const p of players) m.set(p.id, p.display_name);
    nameMap.current = m;
  }

  // Pending-only local order for optimistic drag-to-reorder
  const sortedPending = matches
    .filter((m) => m.status === "pending")
    .sort((a, b) => (a.queue_position ?? Infinity) - (b.queue_position ?? Infinity));

  const [pendingOrder, setPendingOrder] = useState<ClubMatch[]>(sortedPending);

  // Keep local order in sync when server data changes
  useEffect(() => {
    setPendingOrder(
      matches
        .filter((m) => m.status === "pending")
        .sort((a, b) => (a.queue_position ?? Infinity) - (b.queue_position ?? Infinity)),
    );
  }, [matches]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = pendingOrder.findIndex((m) => m.id === active.id);
    const newIndex = pendingOrder.findIndex((m) => m.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;

    const reordered = arrayMove(pendingOrder, oldIndex, newIndex);
    setPendingOrder(reordered);

    startReorder(async () => {
      const res = await reorderClubQueueAction(clubId, reordered.map((m) => m.id));
      if ("error" in res) {
        toast.error(res.error);
        router.refresh();
      } else {
        router.refresh();
      }
    });
  }

  function onRefresh() {
    router.refresh();
  }

  const inProgress = matches.filter((m) => m.status === "in_progress");

  const completed = matches
    .filter((m) => m.status === "completed")
    .sort(
      (a, b) =>
        new Date(b.ended_at ?? b.created_at).getTime() -
        new Date(a.ended_at ?? a.created_at).getTime(),
    )
    .slice(0, 15);

  const courts = Array.from(
    { length: settings.court_count },
    (_, i) => i + 1,
  );

  return (
    <Tabs defaultValue="pending" className="space-y-3">
      <TabsList className="w-full flex-wrap h-auto">
        <TabsTrigger value="pending" className="gap-1.5">
          รอแข่ง{" "}
          <Badge variant="outline" className="text-[10px] px-1 py-0">
            {pendingOrder.length}
          </Badge>
        </TabsTrigger>
        <TabsTrigger value="in_progress" className="gap-1.5">
          กำลังแข่ง{" "}
          <Badge variant="outline" className="text-[10px] px-1 py-0">
            {inProgress.length}
          </Badge>
        </TabsTrigger>
        <TabsTrigger value="completed" className="gap-1.5">
          จบแล้ว{" "}
          <Badge variant="outline" className="text-[10px] px-1 py-0">
            {completed.length}
          </Badge>
        </TabsTrigger>
      </TabsList>

      {/* ── รอแข่ง tab ── */}
      <TabsContent value="pending" className="space-y-3 mt-0">
        {canManage && (
          <div className="flex flex-wrap gap-2">
            {courts.map((c) => (
              <BuildButton
                key={c}
                clubId={clubId}
                court={c}
                onRefresh={onRefresh}
              />
            ))}
            <ManualMatchDialog
              clubId={clubId}
              players={players}
              settings={settings}
              onRefresh={onRefresh}
            />
          </div>
        )}

        {canManage && pendingOrder.length >= 2 && (
          <p className="text-xs text-muted-foreground flex items-center gap-1.5">
            {reorderPending && (
              <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
            )}
            ลากเพื่อจัดลำดับ
          </p>
        )}

        <Card>
          <CardContent className="py-3 px-4">
            {pendingOrder.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                ยังไม่มีแมตช์ในคิว
              </p>
            ) : canManage ? (
              <DndContext
                id="club-queue-dnd"
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={onDragEnd}
              >
                <SortableContext
                  items={pendingOrder.map((m) => m.id)}
                  strategy={verticalListSortingStrategy}
                >
                  <ul className="m-0 p-0">
                    {pendingOrder.map((m, i) => (
                      <SortablePendingRow
                        key={m.id}
                        match={m}
                        nameMap={nameMap.current}
                        onRefresh={onRefresh}
                        rowNumber={i + 1}
                      />
                    ))}
                  </ul>
                </SortableContext>
              </DndContext>
            ) : (
              pendingOrder.map((m, i) => (
                <PendingRow
                  key={m.id}
                  match={m}
                  nameMap={nameMap.current}
                  canManage={false}
                  onRefresh={onRefresh}
                  rowNumber={i + 1}
                />
              ))
            )}
          </CardContent>
        </Card>
      </TabsContent>

      {/* ── กำลังแข่ง tab ── */}
      <TabsContent value="in_progress" className="mt-0">
        <Card>
          <CardContent className="py-3 px-4">
            {inProgress.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                ไม่มีแมตช์กำลังแข่งขัน
              </p>
            ) : (
              inProgress.map((m) => (
                <InProgressRow
                  key={m.id}
                  match={m}
                  nameMap={nameMap.current}
                  canManage={canManage}
                  onRefresh={onRefresh}
                />
              ))
            )}
          </CardContent>
        </Card>
      </TabsContent>

      {/* ── จบแล้ว tab ── */}
      <TabsContent value="completed" className="mt-0">
        <Card>
          <CardContent className="py-3 px-4">
            {completed.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                ยังไม่มีแมตช์ที่จบแล้ว
              </p>
            ) : (
              completed.map((m) => (
                <CompletedRow
                  key={m.id}
                  match={m}
                  nameMap={nameMap.current}
                  canManage={canManage}
                  onRefresh={onRefresh}
                />
              ))
            )}
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  );
}
