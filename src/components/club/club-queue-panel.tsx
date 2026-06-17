"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "@bprogress/next/app";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { GripVertical, Minus, Plus, Play, X, Trophy, ChevronDown, ChevronUp, ChevronsUpDown, Check, PenLine, Trash2, AlertTriangle } from "lucide-react";
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
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  setClubMatchCourtAction,
  createClubManualMatchAction,
  setClubMatchPlayersAction,
  reorderClubQueueAction,
  deleteClubMatchAction,
} from "@/lib/actions/club-matches";
import type { ClubMatch } from "@/lib/types";
import { isClubMatchFull } from "@/lib/club/queue";
import type { ClubQueueSettings } from "@/lib/club/queue-settings";
import { firstFreeCourt, occupiedCourtMap } from "@/lib/club/courts";
import { cn } from "@/lib/utils";

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Pending queue order: queue_position asc, then created_at asc as tiebreak.
// There's no DB unique constraint on queue_position, so concurrent tail-inserts
// can land on the same position; the created_at tiebreak makes that harmless —
// rows still order deterministically by insert time instead of arbitrarily.
function byQueueThenCreated(a: ClubMatch, b: ClubMatch): number {
  const qa = a.queue_position ?? Infinity;
  const qb = b.queue_position ?? Infinity;
  if (qa !== qb) return qa - qb;
  return a.created_at.localeCompare(b.created_at);
}

function formatElapsed(startedAt: string): string {
  const elapsedMs = Date.now() - new Date(startedAt).getTime();
  if (elapsedMs < 0) return "0:00";
  const totalSec = Math.floor(elapsedMs / 1000);
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function resolveSide(
  player1: string | null,
  player2: string | null,
  nameMap: Map<string, string>,
): string {
  const n1 = player1 ? (nameMap.get(player1) ?? "—") : "—";
  if (!player2) return n1;
  const n2 = nameMap.get(player2) ?? "—";
  return `${n1} / ${n2}`;
}

// The 4 player slots as inline-edit state, derived from a match row (null → "" so the
// combobox shows its placeholder). Shared by the seed, the re-sync effect, and the revert.
function slotsFromMatch(m: ClubMatch) {
  return {
    a1: m.side_a_player1 ?? "",
    a2: m.side_a_player2 ?? "",
    b1: m.side_b_player1 ?? "",
    b2: m.side_b_player2 ?? "",
  };
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
  const t = useTranslations("club.queuePanel");
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
    <div className="flex items-center gap-1.5 shrink-0">
      <span className="text-xs tabular-nums font-medium">
        🏸 {match.shuttles_used}
      </span>
      {canManage && (
        // Symmetric outline stepper so −/+ read as a clear "ลูก" control rather
        // than two faint ghost glyphs. Minus stays visible (disabled at 0) so the
        // pair doesn't reflow when the count hits zero.
        <div className="flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 px-2 text-xs gap-0.5"
                  disabled={busy || match.shuttles_used === 0}
                  onClick={() => adjust(-1)}
                >
                  <Minus className="h-3.5 w-3.5" /> {t("shuttleMinus")}
                </Button>
              }
            />
            <TooltipContent>{t("shuttleDecrTooltip")}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 px-2 text-xs gap-0.5"
                  disabled={busy}
                  onClick={() => adjust(1)}
                >
                  <Plus className="h-3.5 w-3.5" /> {t("shuttlePlus")}
                </Button>
              }
            />
            <TooltipContent>{t("shuttleIncrTooltip")}</TooltipContent>
          </Tooltip>
        </div>
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
  const t = useTranslations("club.queuePanel");
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
        toast.success(t("toastDeleted"));
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
            aria-label={t("deleteMatchAriaLabel")}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-destructive shrink-0" />
            {t("deleteDialogTitle")}
          </DialogTitle>
        </DialogHeader>

        <ul className="text-sm text-muted-foreground space-y-1.5 list-disc pl-5">
          <li>{t("deleteDialogBullet1")}</li>
          {status === "completed" && (
            <li>{t("deleteDialogBullet2Completed")}</li>
          )}
          <li>{t("deleteDialogBullet3")}</li>
          {status === "in_progress" && (
            <li>{t("deleteDialogBullet4InProgress")}</li>
          )}
          <li>{t("deleteDialogBullet5")}</li>
        </ul>

        <DialogFooter>
          <DialogClose render={<Button variant="outline" disabled={pending}>{t("deleteDialogCancel")}</Button>} />
          <Button variant="destructive" onClick={handleConfirm} disabled={pending}>
            {pending ? t("deleteDialogDeleting") : t("deleteDialogConfirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Court badge / picker ─────────────────────────────────────────────────────
// Read-only viewers (or a club with ≤1 court) see a static badge; managers get a
// Select that moves a pending / in_progress match to another court via
// setClubMatchCourtAction (server enforces occupancy on in_progress).
function CourtSelect({
  match,
  courts,
  canManage,
  onRefresh,
  badgeClassName,
}: {
  match: ClubMatch;
  courts: string[];
  canManage: boolean;
  onRefresh: () => void;
  badgeClassName?: string;
}) {
  const t = useTranslations("club.queuePanel");
  const [busy, startTransition] = useTransition();

  if (!canManage || courts.length <= 1) {
    return (
      <Badge variant="outline" className={badgeClassName ?? "shrink-0 text-xs"}>
        {t("courtBadge", { court: match.court })}
      </Badge>
    );
  }

  function handleChange(next: string) {
    if (!next || next === match.court) return;
    startTransition(async () => {
      const res = await setClubMatchCourtAction({ matchId: match.id, court: next });
      if ("error" in res) toast.error(res.error);
      else onRefresh();
    });
  }

  return (
    <Select value={match.court} onValueChange={(v) => { if (v) handleChange(v); }}>
      <SelectTrigger
        aria-label={t("courtSelectAriaLabel")}
        title={t("courtSelectTitle")}
        disabled={busy}
        className="h-7 w-auto gap-1 text-xs shrink-0"
      >
        <SelectValue>{(v: string) => t("courtSelectValue", { court: v })}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {courts.map((c) => (
          <SelectItem key={c} value={c}>
            {t("courtSelectItem", { court: c })}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// ─── Pending match row ────────────────────────────────────────────────────────

function PendingRow({
  match,
  nameMap,
  players,
  playersPerTeam,
  courts,
  canManage,
  onRefresh,
  dragHandleProps,
  rowNumber,
}: {
  match: ClubMatch;
  nameMap: Map<string, string>;
  players: { id: string; display_name: string }[];
  playersPerTeam: number;
  courts: string[];
  canManage: boolean;
  onRefresh: () => void;
  dragHandleProps?: Record<string, unknown> | null;
  rowNumber?: number;
}) {
  const t = useTranslations("club.queuePanel");
  const [startBusy, startTransition] = useTransition();
  const [cancelBusy, cancelTransition] = useTransition();
  const [editBusy, editTransition] = useTransition();

  // Local slot state for inline editing (manager only). Seeded from the match row and
  // re-synced when the server row changes (a persist or an external realtime / 30s refresh)
  // — but NOT while a local optimistic edit is in flight (editBusyRef), or a refresh
  // landing mid-edit would flicker the just-picked slot back to its old value.
  const [slots, setSlots] = useState(() => slotsFromMatch(match));
  const editBusyRef = useRef(false);
  editBusyRef.current = editBusy;
  useEffect(() => {
    if (editBusyRef.current) return;
    setSlots(slotsFromMatch(match));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [match.side_a_player1, match.side_a_player2, match.side_b_player1, match.side_b_player2]);

  const sideA = resolveSide(match.side_a_player1, match.side_a_player2, nameMap);
  const sideB = resolveSide(match.side_b_player1, match.side_b_player2, nameMap);
  // Fullness from the LIVE local slots (manager) so the "เริ่ม" button flips the instant
  // the roster completes — before the persist round-trip lands. Read-only uses the row.
  const isMatchFull = isClubMatchFull(
    canManage
      ? {
          side_a_player1: slots.a1 || null,
          side_a_player2: slots.a2 || null,
          side_b_player1: slots.b1 || null,
          side_b_player2: slots.b2 || null,
        }
      : match,
    playersPerTeam,
  );

  type SlotKey = "a1" | "a2" | "b1" | "b2";
  // Options for one slot: every club player except those already placed in this match's
  // OTHER slots — the autocomplete never offers a player already in the match.
  function optionsFor(self: SlotKey) {
    const used = new Set<string>();
    (["a1", "a2", "b1", "b2"] as SlotKey[]).forEach((k) => {
      if (k !== self && slots[k]) used.add(slots[k]);
    });
    return players.filter((p) => !used.has(p.id));
  }

  // Pick / change / clear a slot inline → persist the whole roster immediately. Optimistic
  // (the slot updates instantly); on error, toast + revert to the server row.
  function changeSlot(self: SlotKey, id: string) {
    const next = { ...slots, [self]: id };
    setSlots(next);
    const sideAArr = (playersPerTeam === 2 ? [next.a1, next.a2] : [next.a1]).filter(Boolean);
    const sideBArr = (playersPerTeam === 2 ? [next.b1, next.b2] : [next.b1]).filter(Boolean);
    editTransition(async () => {
      const res = await setClubMatchPlayersAction({ matchId: match.id, sideA: sideAArr, sideB: sideBArr });
      if ("error" in res) {
        toast.error(res.error);
        setSlots(slotsFromMatch(match)); // revert optimistic edit to server truth
      } else {
        onRefresh();
      }
    });
  }

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
                aria-label={t("dragRowAriaLabel")}
                className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground touch-none shrink-0"
              >
                <GripVertical className="h-4 w-4" />
              </button>
            }
          />
          <TooltipContent>{t("dragRowTooltip")}</TooltipContent>
        </Tooltip>
      )}
      {rowNumber != null && (
        <span className="text-xs font-mono text-muted-foreground w-5 shrink-0 text-right">
          {rowNumber}.
        </span>
      )}
      <CourtSelect
        match={match}
        courts={courts}
        canManage={canManage}
        onRefresh={onRefresh}
        badgeClassName="shrink-0 text-xs"
      />
      {canManage ? (
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
          <InlinePlayerSlot value={slots.a1} options={optionsFor("a1")} nameMap={nameMap} disabled={editBusy} onPick={(id) => changeSlot("a1", id)} />
          {playersPerTeam === 2 && (
            <InlinePlayerSlot value={slots.a2} options={optionsFor("a2")} nameMap={nameMap} disabled={editBusy} onPick={(id) => changeSlot("a2", id)} />
          )}
          <span className="px-0.5 text-xs text-muted-foreground">vs</span>
          <InlinePlayerSlot value={slots.b1} options={optionsFor("b1")} nameMap={nameMap} disabled={editBusy} onPick={(id) => changeSlot("b1", id)} />
          {playersPerTeam === 2 && (
            <InlinePlayerSlot value={slots.b2} options={optionsFor("b2")} nameMap={nameMap} disabled={editBusy} onPick={(id) => changeSlot("b2", id)} />
          )}
        </div>
      ) : (
        <span className="flex-1 text-sm truncate">
          {sideA} <span className="text-muted-foreground">vs</span> {sideB}
        </span>
      )}
      {canManage && (
        <div className="flex items-center gap-1 shrink-0">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  size="sm"
                  variant="default"
                  className="h-7 px-2"
                  disabled={startBusy || editBusy || !isMatchFull}
                  onClick={handleStart}
                  aria-label={isMatchFull ? t("startTooltip", { court: match.court }) : t("startNeedsFullTooltip")}
                >
                  <Play className="h-3.5 w-3.5" />
                </Button>
              }
            />
            <TooltipContent>
              {isMatchFull ? t("startTooltip", { court: match.court }) : t("startNeedsFullTooltip")}
            </TooltipContent>
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
                  aria-label={t("cancelTooltip")}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              }
            />
            <TooltipContent>{t("cancelTooltip")}</TooltipContent>
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
  players,
  playersPerTeam,
  courts,
  onRefresh,
  rowNumber,
}: {
  match: ClubMatch;
  nameMap: Map<string, string>;
  players: { id: string; display_name: string }[];
  playersPerTeam: number;
  courts: string[];
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
        players={players}
        playersPerTeam={playersPerTeam}
        courts={courts}
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
  courts,
  canManage,
  onRefresh,
}: {
  match: ClubMatch;
  nameMap: Map<string, string>;
  courts: string[];
  canManage: boolean;
  onRefresh: () => void;
}) {
  const t = useTranslations("club.queuePanel");
  const [finishOpen, setFinishOpen] = useState(false);
  const [finishBusy, finishTransition] = useTransition();
  const [scoreA, setScoreA] = useState("");
  const [scoreB, setScoreB] = useState("");

  const sideA = resolveSide(match.side_a_player1, match.side_a_player2, nameMap);
  const sideB = resolveSide(match.side_b_player1, match.side_b_player2, nameMap);

  function handleFinish(opts: {
    winnerSide?: "a" | "b";
    scoreA?: number;
    scoreB?: number;
  } = {}) {
    finishTransition(async () => {
      const res = await finishClubMatchAction({ matchId: match.id, ...opts });
      if ("error" in res) {
        toast.error(res.error);
      } else {
        setFinishOpen(false);
        setScoreA("");
        setScoreB("");
        onRefresh();
      }
    });
  }

  function handleScoreFinish() {
    const a = parseInt(scoreA, 10);
    const b = parseInt(scoreB, 10);
    if (Number.isNaN(a) || Number.isNaN(b)) {
      toast.error(t("toastScoreInvalidError"));
      return;
    }
    if (a < 0 || b < 0 || a > 99 || b > 99) {
      toast.error(t("toastScoreRangeError"));
      return;
    }
    if (a === b) {
      toast.error(t("toastScoreEqualError"));
      return;
    }
    handleFinish({ scoreA: a, scoreB: b });
  }

  return (
    <div className="py-2 border-b last:border-0">
      <div className="flex items-center gap-2">
        <CourtSelect
          match={match}
          courts={courts}
          canManage={canManage}
          onRefresh={onRefresh}
          badgeClassName="shrink-0 text-xs bg-warning/20 text-warning-foreground border-warning/40"
        />
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
                    <span className="text-xs ml-1">{t("finishButton")}</span>
                  </Button>
                }
              />
              <TooltipContent>{t("finishTooltip", { court: match.court })}</TooltipContent>
            </Tooltip>
            <DeleteMatchButton matchId={match.id} status="in_progress" onRefresh={onRefresh} />
          </>
        )}
      </div>

      {finishOpen && canManage && (
        <div className="mt-2 ml-2 flex flex-col gap-2">
          {/* โหมด 1 — กรอกคะแนนเต็ม (ผู้ชนะคำนวณจากคะแนน) */}
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground shrink-0">{t("scoreLabel")}</span>
            <Input
              type="number"
              inputMode="numeric"
              min={0}
              max={99}
              value={scoreA}
              onChange={(e) => setScoreA(e.target.value)}
              disabled={finishBusy}
              aria-label={t("scoreAriaLabel", { side: sideA })}
              className="h-7 w-14 text-center text-xs"
            />
            <span className="text-xs text-muted-foreground">:</span>
            <Input
              type="number"
              inputMode="numeric"
              min={0}
              max={99}
              value={scoreB}
              onChange={(e) => setScoreB(e.target.value)}
              disabled={finishBusy}
              aria-label={t("scoreAriaLabel", { side: sideB })}
              className="h-7 w-14 text-center text-xs"
            />
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    size="sm"
                    variant="default"
                    className="h-7 text-xs"
                    disabled={finishBusy}
                    onClick={handleScoreFinish}
                  >
                    {t("saveScoreButton")}
                  </Button>
                }
              />
              <TooltipContent>{t("saveScoreTooltip")}</TooltipContent>
            </Tooltip>
          </div>
          {/* โหมด 2/3 — กดฝั่งผู้ชนะ หรือจบแบบไม่ระบุผล */}
          <div className="flex flex-wrap gap-2">
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    disabled={finishBusy}
                    onClick={() => handleFinish({ winnerSide: "a" })}
                  >
                    <Trophy className="h-3 w-3 mr-1" />
                    {t("sideAWins")}
                  </Button>
                }
              />
              <TooltipContent>{t("sideAWinsTooltip", { name: sideA })}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    disabled={finishBusy}
                    onClick={() => handleFinish({ winnerSide: "b" })}
                  >
                    <Trophy className="h-3 w-3 mr-1" />
                    {t("sideBWins")}
                  </Button>
                }
              />
              <TooltipContent>{t("sideBWinsTooltip", { name: sideB })}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs"
                    disabled={finishBusy}
                    onClick={() => handleFinish({})}
                  >
                    {t("noResult")}
                  </Button>
                }
              />
              <TooltipContent>{t("noResultTooltip")}</TooltipContent>
            </Tooltip>
          </div>
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
  const t = useTranslations("club.queuePanel");
  const sideA = resolveSide(match.side_a_player1, match.side_a_player2, nameMap);
  const sideB = resolveSide(match.side_b_player1, match.side_b_player2, nameMap);

  const winnerA = match.winner_side === "a";
  const winnerB = match.winner_side === "b";

  return (
    <div className="flex items-center gap-2 py-2 border-b last:border-0 text-sm text-muted-foreground">
      <Badge variant="outline" className="shrink-0 text-xs opacity-60">
        {t("courtBadge", { court: match.court })}
      </Badge>
      <span className={winnerA ? "text-winner font-medium" : ""}>{sideA}</span>
      <span className="text-xs">vs</span>
      <span className={winnerB ? "text-winner font-medium" : ""}>{sideB}</span>
      {match.score_a != null && match.score_b != null && (
        <span className="text-xs font-medium tabular-nums text-foreground shrink-0">
          {match.score_a} : {match.score_b}
        </span>
      )}
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
  court: string;
  onRefresh: () => void;
}) {
  const t = useTranslations("club.queuePanel");
  const [busy, transition] = useTransition();

  function handleBuild() {
    transition(async () => {
      const res = await buildNextClubMatchAction(clubId, court);
      if ("error" in res) {
        toast.error(res.error);
      } else {
        toast.success(t("toastBuilt", { court }));
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
            {t("buildCourtButton", { court })}
          </Button>
        }
      />
      <TooltipContent>{t("buildCourtTooltip", { court })}</TooltipContent>
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
  const t = useTranslations("club.queuePanel");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const selectedName = value ? (nameMap.get(value) ?? value) : "";
  const q = query.trim().toLowerCase();
  const filtered = q
    ? players.filter((p) => p.display_name.toLowerCase().includes(q))
    : players;

  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </Label>
      <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setQuery(""); }}>
        <PopoverTrigger
          render={
            <Button
              id={id}
              type="button"
              variant="outline"
              role="combobox"
              aria-expanded={open}
              className="w-full h-8 justify-between font-normal text-sm"
            >
              <span className={`truncate ${selectedName ? "" : "text-muted-foreground"}`}>
                {selectedName || t("manualSelectPlayer")}
              </span>
              <ChevronsUpDown className="h-3.5 w-3.5 opacity-50 shrink-0" />
            </Button>
          }
        />
        <PopoverContent className="w-(--anchor-width) p-0 gap-0" align="start">
          <Command shouldFilter={false}>
            <CommandInput placeholder={t("manualSearchPlaceholder")} value={query} onValueChange={setQuery} />
            <CommandList>
              <CommandEmpty>{t("manualNoPlayer")}</CommandEmpty>
              <CommandGroup>
                {filtered.map((p) => (
                  <CommandItem
                    key={p.id}
                    value={p.id}
                    onSelect={() => { onChange(p.id); setOpen(false); setQuery(""); }}
                  >
                    <span className="flex-1 truncate">{p.display_name}</span>
                    {value === p.id && <Check className="h-4 w-4 shrink-0" />}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}

// ─── Manual match dialog ──────────────────────────────────────────────────────

const UNSET = "";

/** Order-independent key for a side's player set (sorted ids). */
function sideKey(ids: (string | null | undefined)[]): string {
  return ids.filter(Boolean).slice().sort().join("|");
}

function ManualMatchDialog({
  clubId,
  players,
  settings,
  courts,
  matches,
  onRefresh,
}: {
  clubId: string;
  players: { id: string; display_name: string }[];
  settings: ClubQueueSettings;
  courts: string[];
  matches: ClubMatch[];
  onRefresh: () => void;
}) {
  const t = useTranslations("club.queuePanel");
  const ppt = settings.players_per_team;
  const [open, setOpen] = useState(false);
  const [busy, startTransition] = useTransition();

  const [court, setCourt] = useState(() => firstFreeCourt(courts, matches));
  const [sideA1, setSideA1] = useState(UNSET);
  const [sideA2, setSideA2] = useState(UNSET);
  const [sideB1, setSideB1] = useState(UNSET);
  const [sideB2, setSideB2] = useState(UNSET);

  // Latest matches read by the snap effect without being a dependency — occupancy
  // churning every 30s refresh must NOT re-run the effect (it would re-pick a free
  // court and could jump the selection on a background refresh while the dialog is open).
  const matchesRef = useRef(matches);
  matchesRef.current = matches;

  // The dialog stays mounted across refreshes, so `court` can outlive its court if
  // the list changes (e.g. a court renamed/removed in Settings). Snap back to a valid
  // court rather than submitting a stale name. Depends only on courts/court; reads
  // matches via ref so only an actual court removal (not occupancy) moves the selection.
  useEffect(() => {
    if (court && !courts.includes(court)) setCourt(firstFreeCourt(courts, matchesRef.current));
  }, [courts, court]);

  const nameMap = useMemo(
    () => new Map(players.map((p) => [p.id, p.display_name])),
    [players],
  );

  // In-progress match occupying each court (for the court-picker grid) — same source
  // `firstFreeCourt` derives from, so the grid labels and the default can't disagree.
  const occupiedByCourt = useMemo(() => occupiedCourtMap(matches), [matches]);

  // Prior meetings: non-cancelled matches where the same two pairs (order-
  // independent, within-side and between-side) already faced each other.
  const priorMeetings = useMemo(() => {
    const sideA = ppt === 2 ? [sideA1, sideA2] : [sideA1];
    const sideB = ppt === 2 ? [sideB1, sideB2] : [sideB1];
    const all = [...sideA, ...sideB];
    if (all.some((id) => !id) || new Set(all).size !== all.length) return [];
    const a = sideKey(sideA);
    const b = sideKey(sideB);
    return matches
      .filter((m) => {
        if (m.status === "cancelled") return false;
        const ma = sideKey([m.side_a_player1, m.side_a_player2]);
        const mb = sideKey([m.side_b_player1, m.side_b_player2]);
        return (ma === a && mb === b) || (ma === b && mb === a);
      })
      .sort(
        (x, y) =>
          new Date(y.ended_at ?? y.created_at).getTime() -
          new Date(x.ended_at ?? x.created_at).getTime(),
      );
  }, [matches, sideA1, sideA2, sideB1, sideB2, ppt]);

  const lastMeetingLabel = useMemo(() => {
    const last = priorMeetings[0];
    if (!last) return "";
    if (last.status === "in_progress") return t("priorInProgress");
    if (last.status === "pending") return t("priorPending");
    // completed
    const hasScore = last.score_a != null && last.score_b != null;
    const winnerIds =
      last.winner_side === "a"
        ? [last.side_a_player1, last.side_a_player2]
        : last.winner_side === "b"
          ? [last.side_b_player1, last.side_b_player2]
          : [];
    const winnerName = winnerIds
      .filter(Boolean)
      .map((id) => nameMap.get(id!) ?? "?")
      .join(" & ");
    if (hasScore && winnerName) return t("priorWinnerScore", { name: winnerName, a: last.score_a ?? 0, b: last.score_b ?? 0 });
    if (hasScore) return t("priorScore", { a: last.score_a ?? 0, b: last.score_b ?? 0 });
    if (winnerName) return t("priorWinner", { name: winnerName });
    return t("priorNoResult");
  }, [priorMeetings, nameMap, t]);

  function reset() {
    setCourt(firstFreeCourt(courts, matches));
    setSideA1(UNSET);
    setSideA2(UNSET);
    setSideB1(UNSET);
    setSideB2(UNSET);
  }

  function handleSubmit() {
    const sideA = (ppt === 2 ? [sideA1, sideA2] : [sideA1]).filter(Boolean);
    const sideB = (ppt === 2 ? [sideB1, sideB2] : [sideB1]).filter(Boolean);
    const all = [...sideA, ...sideB];

    // Partial roster allowed: reserve a court with as few as 1 player, fill the rest
    // later. Start stays gated on a full roster (server + the row's disabled "เริ่ม").
    if (all.length < 1) {
      toast.error(t("toastManualSelectAtLeastOne"));
      return;
    }
    if (new Set(all).size !== all.length) {
      toast.error(t("toastManualDuplicate"));
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
        toast.success(t("toastManualAdded"));
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
            {t("addManualMatch")}
          </Button>
        }
      />
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("manualDialogTitle")}</DialogTitle>
          <p className="text-xs text-muted-foreground">{t("manualPartialHint")}</p>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Court — toggle grid showing live occupancy (occupied courts stay selectable) */}
          <div className="space-y-1.5">
            <Label id="mm-court-label" className="text-sm font-medium">{t("manualCourtLabel")}</Label>
            {courts.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                {t("manualNoCourts")}
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-2" role="group" aria-labelledby="mm-court-label">
                {courts.map((c) => {
                  const occ = occupiedByCourt.get(c);
                  const selected = court === c;
                  return (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setCourt(c)}
                      aria-pressed={selected}
                      className={cn(
                        "flex flex-col items-start gap-0.5 rounded-md border px-3 py-2 text-left transition-colors",
                        selected
                          ? "border-primary bg-primary/10 ring-1 ring-primary"
                          : "border-border hover:border-primary/50 hover:bg-muted/50",
                      )}
                    >
                      <span className="flex w-full items-center gap-1.5 text-sm font-medium">
                        {t("courtSelectItem", { court: c })}
                        {selected && <Check className="h-3.5 w-3.5 text-primary" />}
                      </span>
                      {occ ? (
                        <span className="line-clamp-2 text-[11px] leading-tight text-warning-foreground">
                          {t("manualCourtOccupied", { players: `${resolveSide(occ.side_a_player1, occ.side_a_player2, nameMap)} vs ${resolveSide(occ.side_b_player1, occ.side_b_player2, nameMap)}` })}
                        </span>
                      ) : (
                        <span className="text-[11px] leading-tight text-muted-foreground">
                          {t("manualCourtFree")}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Side A */}
          <div className="space-y-2">
            <p className="text-sm font-medium">{t("manualSideA")}</p>
            <PlayerSelect
              id="mm-sideA1"
              label={ppt === 2 ? t("manualPlayer1") : t("manualPlayer")}
              value={sideA1}
              onChange={setSideA1}
              players={players}
              nameMap={nameMap}
            />
            {ppt === 2 && (
              <PlayerSelect
                id="mm-sideA2"
                label={t("manualPlayer2")}
                value={sideA2}
                onChange={setSideA2}
                players={players}
                nameMap={nameMap}
              />
            )}
          </div>

          {/* Side B */}
          <div className="space-y-2">
            <p className="text-sm font-medium">{t("manualSideB")}</p>
            <PlayerSelect
              id="mm-sideB1"
              label={ppt === 2 ? t("manualPlayer1") : t("manualPlayer")}
              value={sideB1}
              onChange={setSideB1}
              players={players}
              nameMap={nameMap}
            />
            {ppt === 2 && (
              <PlayerSelect
                id="mm-sideB2"
                label={t("manualPlayer2")}
                value={sideB2}
                onChange={setSideB2}
                players={players}
                nameMap={nameMap}
              />
            )}
          </div>

          {priorMeetings.length > 0 && (
            <div className="flex gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs">
              <AlertTriangle className="h-4 w-4 shrink-0 text-warning mt-0.5" />
              <div className="space-y-0.5">
                <p className="font-medium text-warning-foreground">
                  {t("priorMeetingsWarning", { count: priorMeetings.length })}
                </p>
                {lastMeetingLabel && (
                  <p className="text-muted-foreground">{t("priorMeetingsLast", { label: lastMeetingLabel })}</p>
                )}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <DialogClose render={<Button variant="outline" disabled={busy}>{t("manualDialogCancel")}</Button>} />
          <Button
            onClick={handleSubmit}
            disabled={busy}
            variant={priorMeetings.length > 0 ? "destructive" : "default"}
          >
            {busy
              ? t("manualDialogCreating")
              : priorMeetings.length > 0
                ? t("manualDialogSubmitConfirm")
                : t("manualDialogSubmit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Inline player slot (pending match) ───────────────────────────────────────
// A compact autocomplete for ONE match slot. `options` is pre-filtered by the parent
// to exclude players already placed in this match's other slots (no dupes). Picking an
// item — or the "clear" item — calls onPick, which persists the whole roster immediately.
// No dialog: the manager edits the lineup right in the queue row.
function InlinePlayerSlot({
  value,
  options,
  nameMap,
  disabled,
  onPick,
}: {
  value: string;
  options: { id: string; display_name: string }[];
  nameMap: Map<string, string>;
  disabled?: boolean;
  onPick: (id: string) => void;
}) {
  const t = useTranslations("club.queuePanel");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const selectedName = value ? (nameMap.get(value) ?? value) : "";
  const q = query.trim().toLowerCase();
  const filtered = q ? options.filter((p) => p.display_name.toLowerCase().includes(q)) : options;

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setQuery(""); }}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="outline"
            size="sm"
            role="combobox"
            aria-expanded={open}
            aria-label={t("slotEditAria")}
            disabled={disabled}
            className="h-7 max-w-[8rem] min-w-[4.5rem] justify-between gap-1 px-2 text-xs font-normal"
          >
            <span className={`truncate ${selectedName ? "" : "text-muted-foreground"}`}>
              {selectedName || t("manualSelectPlayer")}
            </span>
            <ChevronsUpDown className="h-3 w-3 shrink-0 opacity-50" />
          </Button>
        }
      />
      <PopoverContent className="w-(--anchor-width) min-w-44 p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput placeholder={t("manualSearchPlaceholder")} value={query} onValueChange={setQuery} />
          <CommandList>
            <CommandEmpty>{t("manualNoPlayer")}</CommandEmpty>
            <CommandGroup>
              {value && (
                <CommandItem
                  value="__clear__"
                  className="text-muted-foreground"
                  onSelect={() => { onPick(""); setOpen(false); setQuery(""); }}
                >
                  {t("slotClearOption")}
                </CommandItem>
              )}
              {filtered.map((p) => (
                <CommandItem
                  key={p.id}
                  value={p.id}
                  onSelect={() => { onPick(p.id); setOpen(false); setQuery(""); }}
                >
                  <span className="flex-1 truncate">{p.display_name}</span>
                  {value === p.id && <Check className="h-4 w-4 shrink-0" />}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// ─── Main panel ───────────────────────────────────────────────────────────────

export function ClubQueuePanel({
  clubId,
  matches,
  players,
  settings,
  courts,
  canManage,
}: {
  clubId: string;
  matches: ClubMatch[];
  players: { id: string; display_name: string }[];
  settings: ClubQueueSettings;
  courts: string[];
  canManage: boolean;
}) {
  const t = useTranslations("club.queuePanel");
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
    .sort(byQueueThenCreated);

  const [pendingOrder, setPendingOrder] = useState<ClubMatch[]>(sortedPending);

  // Keep local order in sync when server data changes
  useEffect(() => {
    setPendingOrder(
      matches
        .filter((m) => m.status === "pending")
        .sort(byQueueThenCreated),
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
    );

  return (
    <Tabs defaultValue="pending" className="space-y-3">
      <TabsList className="w-full flex-wrap h-auto">
        <TabsTrigger value="pending" className="gap-1.5">
          {t("tabPending")}{" "}
          <Badge variant="outline" className="text-[10px] px-1 py-0">
            {pendingOrder.length}
          </Badge>
        </TabsTrigger>
        <TabsTrigger value="in_progress" className="gap-1.5">
          {t("tabInProgress")}{" "}
          <Badge variant="outline" className="text-[10px] px-1 py-0">
            {inProgress.length}
          </Badge>
        </TabsTrigger>
        <TabsTrigger value="completed" className="gap-1.5">
          {t("tabCompleted")}{" "}
          <Badge variant="outline" className="text-[10px] px-1 py-0">
            {completed.length}
          </Badge>
        </TabsTrigger>
      </TabsList>

      {/* ── รอแข่ง tab ── */}
      <TabsContent value="pending" className="space-y-3 mt-0">
        {canManage && (
          <div className="space-y-2">
            {courts.length === 0 && (
              <p className="text-xs text-muted-foreground">
                {t("noCourts")}
              </p>
            )}
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
                courts={courts}
                matches={matches}
                onRefresh={onRefresh}
              />
            </div>
          </div>
        )}

        {canManage && pendingOrder.length >= 2 && (
          <p className="text-xs text-muted-foreground flex items-center gap-1.5">
            {reorderPending && (
              <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
            )}
            {t("dragHint")}
          </p>
        )}

        <Card>
          <CardContent className="py-3 px-4">
            {pendingOrder.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                {t("pendingEmpty")}
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
                        players={players}
                        playersPerTeam={settings.players_per_team}
                        courts={courts}
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
                  players={players}
                  playersPerTeam={settings.players_per_team}
                  courts={courts}
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
                {t("inProgressEmpty")}
              </p>
            ) : (
              inProgress.map((m) => (
                <InProgressRow
                  key={m.id}
                  match={m}
                  nameMap={nameMap.current}
                  courts={courts}
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
                {t("completedEmpty")}
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
