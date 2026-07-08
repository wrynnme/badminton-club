"use client";

import { useEffect, useMemo, useRef, useState, useTransition, type ReactElement } from "react";
import { useRouter } from "@bprogress/next/app";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { GripVertical, Minus, Plus, Play, X, Trophy, ChevronsUpDown, Check, PenLine, Trash2, AlertTriangle, Clock, RotateCcw, Flag } from "lucide-react";
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
  DialogDescription,
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
  startClubMatchAction,
  finishClubMatchAction,
  cancelClubMatchAction,
  setClubMatchShuttlesAction,
  setClubMatchCourtAction,
  createClubManualMatchAction,
  setClubMatchPlayersAction,
  reorderClubQueueAction,
  deleteClubMatchAction,
  rebuildClubPendingMatchAction,
} from "@/lib/actions/club-matches";
import type { ClubMatch, Game } from "@/lib/types";
import { isClubMatchFull } from "@/lib/club/queue";
import type { ClubQueueSettings } from "@/lib/club/queue-settings";
import { firstFreeCourt, occupiedCourtMap } from "@/lib/club/courts";
import { GenerateQueueDialog } from "@/components/club/generate-queue-dialog";
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

// Fixed play duration (started_at → ended_at) for a finished match. mm:ss, or
// h:mm:ss once it passes an hour. Null if either timestamp is missing.
function formatDuration(startedAt: string | null, endedAt: string | null): string | null {
  if (!startedAt || !endedAt) return null;
  const ms = new Date(endedAt).getTime() - new Date(startedAt).getTime();
  if (ms < 0) return null;
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
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

// A compact {a,b} summary of a finished match for the prior-meeting hint:
// one set → that set's points; multiple sets → sets-won count; legacy row with no
// `games` → its single score_a/score_b; nothing recorded → null.
function clubScoreParts(m: ClubMatch): { a: number; b: number } | null {
  const games = m.games ?? [];
  if (games.length === 1) return { a: games[0].a, b: games[0].b };
  if (games.length > 1) {
    let a = 0;
    let b = 0;
    for (const g of games) {
      if (g.a > g.b) a += 1;
      else if (g.b > g.a) b += 1;
    }
    return { a, b };
  }
  if (m.score_a != null && m.score_b != null) return { a: m.score_a, b: m.score_b };
  return null;
}

// ─── Elapsed ticker — updates every second for a single in_progress match ────

function ElapsedTicker({
  startedAt,
  limitMin = 0,
  overLabel,
}: {
  startedAt: string;
  /** game_time_limit_min; 0 = no limit (no over-time indicator). */
  limitMin?: number;
  /** translated "over time" badge text, shown once the limit is passed. */
  overLabel?: string;
}) {
  const [display, setDisplay] = useState("0:00");
  const [over, setOver] = useState(false);

  useEffect(() => {
    const tick = () => {
      setDisplay(formatElapsed(startedAt));
      if (limitMin > 0) {
        const elapsedSec = (Date.now() - new Date(startedAt).getTime()) / 1000;
        setOver(elapsedSec > limitMin * 60);
      } else {
        setOver(false);
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [startedAt, limitMin]);

  return (
    <span
      className={
        over
          ? "inline-flex items-center gap-1 text-xs tabular-nums font-medium text-destructive"
          : "text-xs tabular-nums text-muted-foreground"
      }
    >
      {display}
      {over && overLabel && (
        <span className="rounded bg-destructive/15 px-1 py-0.5 text-[10px] font-medium text-destructive">
          {overLabel}
        </span>
      )}
    </span>
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
        {match.court ? t("courtBadge", { court: match.court }) : t("courtUnassignedBadge")}
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
        <SelectValue>
          {(v: string | null) => (v ? t("courtSelectValue", { court: v }) : t("courtSelectPlaceholder"))}
        </SelectValue>
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
  settings,
  clubId,
  matches,
  courts,
  canManage,
  onRefresh,
  dragHandleProps,
  rowNumber,
  feederByTarget,
}: {
  match: ClubMatch;
  nameMap: Map<string, string>;
  players: { id: string; display_name: string }[];
  settings: ClubQueueSettings;
  clubId: string;
  matches: ClubMatch[];
  courts: string[];
  canManage: boolean;
  onRefresh: () => void;
  dragHandleProps?: Record<string, unknown> | null;
  rowNumber?: number;
  /** feeder match (still pending/in_progress) keyed `${winner_next_match_id}:${slot}` —
   *  presence means that side is a LIVE "winner of" placeholder, not an empty slot. */
  feederByTarget: Map<string, ClubMatch>;
}) {
  const t = useTranslations("club.queuePanel");
  const ppt = settings.players_per_team;
  const [startBusy, startTransition] = useTransition();
  const [cancelBusy, cancelTransition] = useTransition();
  const [rerollBusy, rerollTransition] = useTransition();

  const sideA = resolveSide(match.side_a_player1, match.side_a_player2, nameMap);
  const sideB = resolveSide(match.side_b_player1, match.side_b_player2, nameMap);
  const isMatchFull = isClubMatchFull(match, ppt);

  // A side is a LIVE "winner of" placeholder when both its player slots are empty AND a
  // still-active feeder match points its winner here — distinct from an ordinary empty
  // slot. Shown read-only as a "winner of #N" label; the edit dialog (✎) locks it.
  const feederA = feederByTarget.get(`${match.id}:a`);
  const feederB = feederByTarget.get(`${match.id}:b`);
  const placeholderA = match.side_a_player1 == null && match.side_a_player2 == null && !!feederA;
  const placeholderB = match.side_b_player1 == null && match.side_b_player2 == null && !!feederB;
  const hasLivePlaceholder = placeholderA || placeholderB;

  function feederLabel(feeder: ClubMatch): string {
    return feeder.status === "in_progress" && feeder.court
      ? t("winnerPlaceholderInProgress", { court: feeder.court })
      : t("winnerPlaceholder", { number: feeder.queue_position ?? "?" });
  }

  // Start-button disable/tooltip priority: missing court > waiting on a live winner
  // placeholder > incomplete roster > ready.
  const startDisabledReason = !match.court
    ? t("startNeedsCourtTooltip")
    : hasLivePlaceholder
      ? t("startWaitingWinnerTooltip")
      : !isMatchFull
        ? t("startNeedsFullTooltip")
        : t("startTooltip", { court: match.court });

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

  function handleReroll() {
    rerollTransition(async () => {
      const res = await rebuildClubPendingMatchAction(match.id);
      if ("error" in res) {
        toast.error(res.error);
      } else {
        toast.success(res.swapped ? t("toastRerolledSwap") : t("toastRerolled"));
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
      {/* Read-only lineup — editing moves to the ✎ dialog. Placeholder sides show the
          "winner of #N" label instead of names. */}
      <span className="min-w-0 flex-1 text-sm truncate">
        {placeholderA ? feederLabel(feederA!) : sideA}{" "}
        <span className="text-muted-foreground">vs</span>{" "}
        {placeholderB ? feederLabel(feederB!) : sideB}
      </span>
      {canManage && (
        <div className="flex items-center gap-1 shrink-0">
          {!(placeholderA && placeholderB) && (
            <MatchFormDialog
              mode="edit"
              match={match}
              clubId={clubId}
              players={players}
              settings={settings}
              courts={courts}
              matches={matches}
              onRefresh={onRefresh}
              placeholderA={placeholderA}
              placeholderB={placeholderB}
              feederLabelA={placeholderA ? feederLabel(feederA!) : undefined}
              feederLabelB={placeholderB ? feederLabel(feederB!) : undefined}
              trigger={
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={t("editMatchAria")}
                  title={t("editMatchTooltip")}
                >
                  <PenLine className="h-3.5 w-3.5" />
                </Button>
              }
            />
          )}
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  size="sm"
                  variant="default"
                  className="h-7 px-2"
                  disabled={startBusy || !isMatchFull || !match.court || hasLivePlaceholder}
                  onClick={handleStart}
                  aria-label={startDisabledReason}
                >
                  <Play className="h-3.5 w-3.5" />
                </Button>
              }
            />
            <TooltipContent>{startDisabledReason}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  size="icon-sm"
                  variant="ghost"
                  disabled={rerollBusy}
                  onClick={handleReroll}
                  aria-label={t("rerollAriaLabel")}
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                </Button>
              }
            />
            <TooltipContent>{t("rerollTooltip")}</TooltipContent>
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
  settings,
  clubId,
  matches,
  courts,
  onRefresh,
  rowNumber,
  feederByTarget,
}: {
  match: ClubMatch;
  nameMap: Map<string, string>;
  players: { id: string; display_name: string }[];
  settings: ClubQueueSettings;
  clubId: string;
  matches: ClubMatch[];
  courts: string[];
  onRefresh: () => void;
  rowNumber: number;
  feederByTarget: Map<string, ClubMatch>;
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
        settings={settings}
        clubId={clubId}
        matches={matches}
        courts={courts}
        canManage
        onRefresh={onRefresh}
        dragHandleProps={{ ...attributes, ...listeners }}
        rowNumber={rowNumber}
        feederByTarget={feederByTarget}
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
  gameTimeLimitMin,
}: {
  match: ClubMatch;
  nameMap: Map<string, string>;
  courts: string[];
  canManage: boolean;
  onRefresh: () => void;
  /** game_time_limit_min from queue settings (0 = no over-time indicator). */
  gameTimeLimitMin: number;
}) {
  const t = useTranslations("club.queuePanel");
  const [finishOpen, setFinishOpen] = useState(false);
  const [finishBusy, finishTransition] = useTransition();
  // Per-set score rows (strings while editing). Starts with one blank set; leaving
  // every set blank finishes winner-only (no score recorded), preserving the quick path.
  const [games, setGames] = useState<{ a: string; b: string }[]>([{ a: "", b: "" }]);

  // Reset to a single blank set each time the finish dialog opens (fresh entry).
  useEffect(() => {
    if (finishOpen) setGames([{ a: "", b: "" }]);
  }, [finishOpen]);

  const sideA = resolveSide(match.side_a_player1, match.side_a_player2, nameMap);
  const sideB = resolveSide(match.side_b_player1, match.side_b_player2, nameMap);

  const addGame = () =>
    setGames((g) => (g.length < 9 ? [...g, { a: "", b: "" }] : g));
  const removeGame = (i: number) =>
    setGames((g) => (g.length > 1 ? g.filter((_, idx) => idx !== i) : g));
  const setGameVal = (i: number, side: "a" | "b", v: string) =>
    setGames((g) => g.map((row, idx) => (idx === i ? { ...row, [side]: v } : row)));

  function handleFinish(opts: { winnerSide?: "a" | "b"; games?: Game[] } = {}) {
    finishTransition(async () => {
      const res = await finishClubMatchAction({ matchId: match.id, ...opts });
      if ("error" in res) {
        toast.error(res.error);
      } else {
        setFinishOpen(false);
        setGames([{ a: "", b: "" }]);
        onRefresh();
      }
    });
  }

  // Collect non-blank set rows. The winner is picked manually (winner buttons), so
  // sets carry no tie check — only range + completeness. Returns null on a bad row
  // (toast already shown); [] when every row is blank (winner-only finish).
  function collectGames(): Game[] | null {
    const out: Game[] = [];
    for (const row of games) {
      const aRaw = row.a.trim();
      const bRaw = row.b.trim();
      if (aRaw === "" && bRaw === "") continue; // untouched row → skip
      const a = parseInt(aRaw, 10);
      const b = parseInt(bRaw, 10);
      if (aRaw === "" || bRaw === "" || Number.isNaN(a) || Number.isNaN(b)) {
        toast.error(t("toastSetIncompleteError"));
        return null;
      }
      if (a < 0 || b < 0 || a > 99 || b > 99) {
        toast.error(t("toastScoreRangeError"));
        return null;
      }
      out.push({ a, b });
    }
    return out;
  }

  function commitFinish(winnerSide?: "a" | "b") {
    const parsed = collectGames();
    if (parsed === null) return;
    handleFinish({ winnerSide, games: parsed });
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
          <ElapsedTicker
            startedAt={match.started_at}
            limitMin={gameTimeLimitMin}
            overLabel={t("overTime")}
          />
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
                    onClick={() => setFinishOpen(true)}
                  >
                    <Flag className="h-3.5 w-3.5" />
                    <span className="text-xs ml-1">{t("finishButton")}</span>
                  </Button>
                }
              />
              <TooltipContent>{t("finishTooltip", { court: match.court ?? "" })}</TooltipContent>
            </Tooltip>
            <DeleteMatchButton matchId={match.id} status="in_progress" onRefresh={onRefresh} />
          </>
        )}
      </div>

      {canManage && (
        <Dialog open={finishOpen} onOpenChange={setFinishOpen}>
          <DialogContent className="sm:max-w-sm max-h-[90dvh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{t("finishDialogTitle")}</DialogTitle>
              <DialogDescription className="text-xs">
                {sideA} vs {sideB}
              </DialogDescription>
            </DialogHeader>

            {/* คะแนนแต่ละเซ็ต — เพิ่ม/ลบเซ็ตได้ (กรอกหรือไม่ก็ได้) */}
            <div className="space-y-2">
              <span className="block text-xs text-muted-foreground">{t("scoreLabel")}</span>
              {games.map((row, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <span className="text-xs text-muted-foreground shrink-0 w-12">
                    {t("setLabel", { n: i + 1 })}
                  </span>
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={99}
                    value={row.a}
                    onChange={(e) => setGameVal(i, "a", e.target.value)}
                    disabled={finishBusy}
                    aria-label={t("scoreAriaLabel", { side: sideA })}
                    className="h-8 w-16 text-center text-sm"
                  />
                  <span className="text-xs text-muted-foreground">:</span>
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={99}
                    value={row.b}
                    onChange={(e) => setGameVal(i, "b", e.target.value)}
                    disabled={finishBusy}
                    aria-label={t("scoreAriaLabel", { side: sideB })}
                    className="h-8 w-16 text-center text-sm"
                  />
                  {games.length > 1 && (
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8 shrink-0 text-muted-foreground"
                            disabled={finishBusy}
                            onClick={() => removeGame(i)}
                            aria-label={t("removeSetAriaLabel", { n: i + 1 })}
                          >
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        }
                      />
                      <TooltipContent>{t("removeSetTooltip")}</TooltipContent>
                    </Tooltip>
                  )}
                </div>
              ))}
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 text-xs"
                      disabled={finishBusy || games.length >= 9}
                      onClick={addGame}
                    >
                      <Plus className="h-3 w-3 mr-1" />
                      {t("addSetButton")}
                    </Button>
                  }
                />
                <TooltipContent>{t("addSetTooltip")}</TooltipContent>
              </Tooltip>
            </div>

            {/* เลือกผู้ชนะเพื่อจบ — บันทึกเซ็ตที่กรอก พร้อมผู้ชนะที่เลือก (เลือกเอง) */}
            <div className="space-y-2">
              <span className="block text-xs text-muted-foreground">{t("pickWinnerLabel")}</span>
              <div className="flex flex-wrap gap-2">
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-9 flex-1 min-w-[130px] text-sm"
                        disabled={finishBusy}
                        onClick={() => commitFinish("a")}
                      >
                        <Trophy className="h-3.5 w-3.5 mr-1 shrink-0" />
                        <span className="truncate">{t("winnerWinsButton", { name: sideA })}</span>
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
                        className="h-9 flex-1 min-w-[130px] text-sm"
                        disabled={finishBusy}
                        onClick={() => commitFinish("b")}
                      >
                        <Trophy className="h-3.5 w-3.5 mr-1 shrink-0" />
                        <span className="truncate">{t("winnerWinsButton", { name: sideB })}</span>
                      </Button>
                    }
                  />
                  <TooltipContent>{t("sideBWinsTooltip", { name: sideB })}</TooltipContent>
                </Tooltip>
              </div>
              {/* A feeder match must promote a winner into its chained target, so
                  "no result" is hidden — finishing it winnerless would strand the
                  downstream "ผู้ชนะจากแมตช์ #N" match (server also rejects it). */}
              {match.winner_next_match_id == null && (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 w-full text-xs"
                        disabled={finishBusy}
                        onClick={() => commitFinish(undefined)}
                      >
                        {t("noResult")}
                      </Button>
                    }
                  />
                  <TooltipContent>{t("noResultTooltip")}</TooltipContent>
                </Tooltip>
              )}
            </div>

            <DialogFooter>
              <DialogClose render={
                <Button variant="outline" disabled={finishBusy}>{t("finishDialogCancel")}</Button>
              } />
            </DialogFooter>
          </DialogContent>
        </Dialog>
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

  const gameSets = match.games ?? [];
  const duration = formatDuration(match.started_at, match.ended_at);
  const winnerA = match.winner_side === "a";
  const winnerB = match.winner_side === "b";

  return (
    <div className="flex items-center gap-2 py-2 border-b last:border-0 text-sm text-muted-foreground">
      <Badge variant="outline" className="shrink-0 text-xs opacity-60">
        {t("courtBadge", { court: match.court ?? "" })}
      </Badge>
      <span className={winnerA ? "text-winner font-medium" : ""}>{sideA}</span>
      <span className="text-xs">vs</span>
      <span className={winnerB ? "text-winner font-medium" : ""}>{sideB}</span>
      {gameSets.length > 0 ? (
        <span className="flex items-center gap-1.5 shrink-0 text-xs font-medium tabular-nums text-foreground">
          {gameSets.map((g, i) => (
            <span key={i}>
              {g.a}-{g.b}
            </span>
          ))}
        </span>
      ) : match.score_a != null && match.score_b != null ? (
        <span className="text-xs font-medium tabular-nums text-foreground shrink-0">
          {match.score_a} : {match.score_b}
        </span>
      ) : null}
      {match.winner_side && (
        <Trophy className="h-3.5 w-3.5 text-warning shrink-0" />
      )}
      {duration && (
        <Tooltip>
          <TooltipTrigger
            render={
              <span className="flex items-center gap-0.5 shrink-0 text-xs tabular-nums text-muted-foreground">
                <Clock className="h-3 w-3" />
                {duration}
              </span>
            }
          />
          <TooltipContent>{t("durationTooltip")}</TooltipContent>
        </Tooltip>
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

function MatchFormDialog({
  clubId,
  players,
  settings,
  courts,
  matches,
  onRefresh,
  mode = "create",
  match,
  placeholderA = false,
  placeholderB = false,
  feederLabelA,
  feederLabelB,
  trigger,
}: {
  clubId: string;
  players: { id: string; display_name: string }[];
  settings: ClubQueueSettings;
  courts: string[];
  matches: ClubMatch[];
  onRefresh: () => void;
  mode?: "create" | "edit";
  match?: ClubMatch;
  /** edit mode — a side that is a live "winner of #N" placeholder is locked (shown as a
   *  read-only label, excluded from submit). Always false in create mode. */
  placeholderA?: boolean;
  placeholderB?: boolean;
  feederLabelA?: string;
  feederLabelB?: string;
  /** custom trigger (the ✎ button for edit); defaults to the "เพิ่มแมตช์เอง" button. */
  trigger?: ReactElement;
}) {
  const t = useTranslations("club.queuePanel");
  const ppt = settings.players_per_team;
  const isEdit = mode === "edit";
  const [open, setOpen] = useState(false);
  const [busy, startTransition] = useTransition();

  const [court, setCourt] = useState(() =>
    isEdit && match ? match.court ?? UNSET : firstFreeCourt(courts, matches),
  );
  const [sideA1, setSideA1] = useState(isEdit && match ? match.side_a_player1 ?? UNSET : UNSET);
  const [sideA2, setSideA2] = useState(isEdit && match ? match.side_a_player2 ?? UNSET : UNSET);
  const [sideB1, setSideB1] = useState(isEdit && match ? match.side_b_player1 ?? UNSET : UNSET);
  const [sideB2, setSideB2] = useState(isEdit && match ? match.side_b_player2 ?? UNSET : UNSET);

  // Latest matches read by the snap/seed effects without being a dependency — occupancy
  // churning every 30s refresh must NOT re-run them (it would re-pick a free court and
  // could jump the selection on a background refresh while the dialog is open).
  const matchesRef = useRef(matches);
  matchesRef.current = matches;

  // Reseed on every open so the form reflects the current match (edit) / a fresh free
  // court (create), even if a background refresh changed things while it was closed.
  // Derived-value reset — NOT bare setState — so reusing the instance for a just-updated
  // match can't show stale data.
  useEffect(() => {
    if (!open) return;
    if (isEdit && match) {
      setCourt(match.court ?? UNSET);
      setSideA1(match.side_a_player1 ?? UNSET);
      setSideA2(match.side_a_player2 ?? UNSET);
      setSideB1(match.side_b_player1 ?? UNSET);
      setSideB2(match.side_b_player2 ?? UNSET);
    } else {
      setCourt(firstFreeCourt(courts, matchesRef.current));
      setSideA1(UNSET);
      setSideA2(UNSET);
      setSideB1(UNSET);
      setSideB2(UNSET);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // The dialog stays mounted across refreshes, so `court` can outlive its court if the
  // list changes (a court renamed/removed in Settings). Snap a stale non-empty court back
  // to a valid one; "" (courtless) is a valid state and left alone.
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
        if (m.id === match?.id) return false; // exclude the match being edited itself
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
  }, [matches, match?.id, sideA1, sideA2, sideB1, sideB2, ppt]);

  const lastMeetingLabel = useMemo(() => {
    const last = priorMeetings[0];
    if (!last) return "";
    if (last.status === "in_progress") return t("priorInProgress");
    if (last.status === "pending") return t("priorPending");
    // completed
    const parts = clubScoreParts(last);
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
    if (parts && winnerName) return t("priorWinnerScore", { name: winnerName, a: parts.a, b: parts.b });
    if (parts) return t("priorScore", { a: parts.a, b: parts.b });
    if (winnerName) return t("priorWinner", { name: winnerName });
    return t("priorNoResult");
  }, [priorMeetings, nameMap, t]);

  function handleSubmit() {
    const sideA = placeholderA ? [] : (ppt === 2 ? [sideA1, sideA2] : [sideA1]).filter(Boolean);
    const sideB = placeholderB ? [] : (ppt === 2 ? [sideB1, sideB2] : [sideB1]).filter(Boolean);
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
      // court is always sent (name or "" for courtless); edit updates players + court in
      // one row UPDATE, create inserts a fresh pending match.
      const res =
        isEdit && match
          ? await setClubMatchPlayersAction({ matchId: match.id, sideA, sideB, court })
          : await createClubManualMatchAction({ clubId, court, sideA, sideB });
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success(isEdit ? t("toastMatchUpdated") : t("toastManualAdded"));
      setOpen(false);
      onRefresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          trigger ?? (
            <Button size="sm" variant="outline" className="h-8 text-xs gap-1">
              <PenLine className="h-3.5 w-3.5" />
              {t("addManualMatch")}
            </Button>
          )
        }
      />
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{isEdit ? t("editDialogTitle") : t("manualDialogTitle")}</DialogTitle>
          <p className="text-xs text-muted-foreground">{t("manualPartialHint")}</p>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Court — toggle grid; tap the selected court again to clear (courtless) */}
          <div className="space-y-1.5">
            <Label id="mm-court-label" className="text-sm font-medium">{t("manualCourtLabel")}</Label>
            {courts.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                {t("manualNoCourts")}
              </p>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-2" role="group" aria-labelledby="mm-court-label">
                  {courts.map((c) => {
                    const occ = occupiedByCourt.get(c);
                    const selected = court === c;
                    return (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setCourt(selected ? UNSET : c)}
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
                <p className="text-[11px] leading-tight text-muted-foreground">{t("courtOptionalHint")}</p>
              </>
            )}
          </div>

          {/* Side A */}
          <div className="space-y-2">
            <p className="text-sm font-medium">{t("manualSideA")}</p>
            {placeholderA ? (
              <div className="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                {feederLabelA}
              </div>
            ) : (
              <>
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
              </>
            )}
          </div>

          {/* Side B */}
          <div className="space-y-2">
            <p className="text-sm font-medium">{t("manualSideB")}</p>
            {placeholderB ? (
              <div className="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                {feederLabelB}
              </div>
            ) : (
              <>
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
              </>
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
              ? isEdit ? t("editDialogSaving") : t("manualDialogCreating")
              : priorMeetings.length > 0
                ? t("manualDialogSubmitConfirm")
                : isEdit ? t("editDialogSubmit") : t("manualDialogSubmit")}
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
  courts,
  canManage,
  clubStart,
  clubEnd,
  batchMinMatches,
}: {
  clubId: string;
  matches: ClubMatch[];
  players: Array<{
    id: string;
    display_name: string;
    status?: string;
    checked_in_at?: string | null;
    start_time?: string | null;
    end_time?: string | null;
  }>;
  settings: ClubQueueSettings;
  courts: string[];
  canManage: boolean;
  /** "HH:MM" club session window — used by GenerateQueueDialog's pro-rated target preview. */
  clubStart?: string;
  clubEnd?: string;
  batchMinMatches?: number;
}) {
  const t = useTranslations("club.queuePanel");
  const router = useRouter();
  const [reorderPending, startReorder] = useTransition();

  // Live "winner of" placeholders: feeder match (still pending/in_progress) keyed
  // `${winner_next_match_id}:${winner_next_match_slot}`. A pending row's side is a
  // placeholder — not an ordinary empty slot — when this map has its `${id}:${side}` key.
  const feederByTarget = useMemo(() => {
    const m = new Map<string, ClubMatch>();
    for (const mt of matches) {
      if (
        mt.winner_next_match_id &&
        mt.winner_next_match_slot &&
        (mt.status === "pending" || mt.status === "in_progress")
      ) {
        m.set(`${mt.winner_next_match_id}:${mt.winner_next_match_slot}`, mt);
      }
    }
    return m;
  }, [matches]);

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

  // Single-page layout (tabs removed 2026-07-07): all three statuses stack in
  // one view, colour-coded per section — live matches first (short + most
  // relevant mid-session; the batch-generated pending list can be long), then
  // the queue, then finished. Empty กำลังแข่ง / จบแล้ว sections are hidden.
  return (
    <div className="space-y-4">
      {/* ── กำลังแข่ง — amber, live ── */}
      {inProgress.length > 0 && (
        <section className="space-y-2">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <span className="h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-warning" />
            {t("tabInProgress")}
            <Badge variant="outline" className="text-[10px] px-1 py-0">
              {inProgress.length}
            </Badge>
          </h3>
          <Card className="border-l-4 border-l-warning/60">
            <CardContent className="py-3 px-4">
              {inProgress.map((m) => (
                <InProgressRow
                  key={m.id}
                  match={m}
                  nameMap={nameMap.current}
                  courts={courts}
                  canManage={canManage}
                  onRefresh={onRefresh}
                  gameTimeLimitMin={settings.game_time_limit_min}
                />
              ))}
            </CardContent>
          </Card>
        </section>
      )}

      {/* ── รอแข่ง — primary ── */}
      <section className="space-y-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-primary" />
          {t("tabPending")}
          <Badge variant="outline" className="text-[10px] px-1 py-0">
            {pendingOrder.length}
          </Badge>
        </h3>
        {canManage && (
          <div className="space-y-2">
            {courts.length === 0 && (
              <p className="text-xs text-muted-foreground">
                {t("noCourts")}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <GenerateQueueDialog
                clubId={clubId}
                players={players.map((p) => ({
                  id: p.id,
                  display_name: p.display_name,
                  status: p.status ?? "active",
                  checked_in_at: p.checked_in_at ?? null,
                  start_time: p.start_time ?? null,
                  end_time: p.end_time ?? null,
                }))}
                matches={matches}
                clubStart={clubStart ?? "00:00"}
                clubEnd={clubEnd ?? "23:59"}
                batchMinMatches={batchMinMatches ?? 3}
                onRefresh={onRefresh}
              />
              <MatchFormDialog
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

        <Card className="border-l-4 border-l-primary/50">
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
                        settings={settings}
                        clubId={clubId}
                        matches={matches}
                        courts={courts}
                        onRefresh={onRefresh}
                        rowNumber={i + 1}
                        feederByTarget={feederByTarget}
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
                  settings={settings}
                  clubId={clubId}
                  matches={matches}
                  courts={courts}
                  canManage={false}
                  onRefresh={onRefresh}
                  rowNumber={i + 1}
                  feederByTarget={feederByTarget}
                />
              ))
            )}
          </CardContent>
        </Card>
      </section>

      {/* ── จบแล้ว — success ── */}
      {completed.length > 0 && (
        <section className="space-y-2">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-success" />
            {t("tabCompleted")}
            <Badge variant="outline" className="text-[10px] px-1 py-0">
              {completed.length}
            </Badge>
          </h3>
          <Card className="border-l-4 border-l-success/50">
            <CardContent className="py-3 px-4">
              {completed.map((m) => (
                <CompletedRow
                  key={m.id}
                  match={m}
                  nameMap={nameMap.current}
                  canManage={canManage}
                  onRefresh={onRefresh}
                />
              ))}
            </CardContent>
          </Card>
        </section>
      )}
    </div>
  );
}
