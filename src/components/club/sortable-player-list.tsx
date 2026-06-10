"use client";

import { useState, useTransition, useId, useEffect, useCallback, useRef, type ReactNode } from "react";
import { useRouter } from "next/navigation";
// Progress-bar-aware router for user mutations; the plain one stays for the
// 30s auto-refresh interval so the top bar doesn't flash on every tick.
import { useRouter as useProgressRouter } from "@bprogress/next/app";
import { RefreshCw, GripVertical, CheckCircle2, Circle, Loader2, Clock } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Pencil } from "lucide-react";
import { LeaveButton } from "@/components/club/leave-button";
import { KickButton } from "@/components/club/kick-button";
import { reorderPlayersAction, toggleCheckInAction, updateClubPlayerSessionAction, renameClubGuestAction, promoteClubReserveAction } from "@/lib/actions/clubs";
import type { ClubPlayer, Level } from "@/lib/types";
import { cn } from "@/lib/utils";

type Props = {
  clubId: string;
  players: ClubPlayer[];
  sessionProfileId: string | null;
  canManage: boolean;
  levels?: Level[];
  /** Club session window — used as placeholder for player time inputs. */
  sessionStart?: string; // "HH:MM:SS"
  sessionEnd?: string;   // "HH:MM:SS"
};

// ─── Check-in button ─────────────────────────────────────────────────────────

function CheckInButton({
  player,
  clubId,
  canToggle,
}: {
  player: ClubPlayer;
  clubId: string;
  canToggle: boolean;
}) {
  const router = useProgressRouter();
  const [pending, start] = useTransition();
  const isCheckedIn = !!player.checked_in_at;

  if (!canToggle) {
    return isCheckedIn ? (
      <span className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400 font-medium">
        <CheckCircle2 className="h-3.5 w-3.5" />
        พร้อม
      </span>
    ) : null;
  }

  return (
    <Button
      size="xs"
      variant={isCheckedIn ? "secondary" : "outline"}
      className={isCheckedIn ? "text-green-600 dark:text-green-400 border-green-500/40 bg-green-500/10 hover:bg-green-500/20" : ""}
      disabled={pending}
      onClick={() =>
        start(async () => {
          const res = await toggleCheckInAction({ club_id: clubId, player_id: player.id });
          if (res && "error" in res) toast.error(res.error);
          else router.refresh();
        })
      }
    >
      {pending ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : isCheckedIn ? (
        <>
          <CheckCircle2 className="h-3 w-3" />
          พร้อม
        </>
      ) : (
        <>
          <Circle className="h-3 w-3" />
          เช็คอิน
        </>
      )}
    </Button>
  );
}

// ─── Session editor (inline, canManage only) ──────────────────────────────────

function SessionEditor({
  player,
  clubId,
  sessionStart,
  sessionEnd,
}: {
  player: ClubPlayer;
  clubId: string;
  sessionStart?: string;
  sessionEnd?: string;
}) {
  const router = useProgressRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();

  const clubStartPlaceholder = sessionStart?.slice(0, 5) ?? "";
  const clubEndPlaceholder = sessionEnd?.slice(0, 5) ?? "";

  // Pre-fill with the player's override, else the club's full window (not blank).
  const [startVal, setStartVal] = useState(player.start_time?.slice(0, 5) ?? clubStartPlaceholder);
  const [endVal, setEndVal] = useState(player.end_time?.slice(0, 5) ?? clubEndPlaceholder);
  const [games, setGames] = useState(player.games_played);

  // Resync from parent when the editor is CLOSED. While open, a background
  // router.refresh() (30s auto-refresh) must not clobber the admin's in-progress edit.
  useEffect(() => {
    if (open) return;
    setStartVal(player.start_time?.slice(0, 5) ?? clubStartPlaceholder);
    setEndVal(player.end_time?.slice(0, 5) ?? clubEndPlaceholder);
    setGames(player.games_played);
  }, [open, player.start_time, player.end_time, player.games_played, clubStartPlaceholder, clubEndPlaceholder]);

  function handleSave() {
    start(async () => {
      const res = await updateClubPlayerSessionAction(clubId, player.id, {
        // A value equal to the club window means "no override" → store null so the
        // partial-session label only shows when the player truly differs.
        start_time: startVal && startVal !== clubStartPlaceholder ? startVal : null,
        end_time: endVal && endVal !== clubEndPlaceholder ? endVal : null,
        games_played: games,
      });
      if (res && "error" in res) {
        toast.error(res.error);
      } else {
        toast.success("บันทึกข้อมูลแล้ว");
        router.refresh();
        setOpen(false);
      }
    });
  }

  if (!open) {
    // Show a subtle summary when anything non-default is set
    const hasOverride = player.start_time || player.end_time || player.games_played > 0;
    return (
      <Button
        size="xs"
        variant="ghost"
        className="text-muted-foreground h-6 px-1.5 text-xs"
        onClick={() => setOpen(true)}
        title="แก้ไขเวลา/เกม"
      >
        <Clock className="h-3 w-3" />
        {hasOverride ? (
          <span className="ml-0.5 tabular-nums">
            {player.games_played > 0 ? `${player.games_played}g` : ""}
            {player.start_time || player.end_time ? " ⏱" : ""}
          </span>
        ) : null}
      </Button>
    );
  }

  return (
    <div className="mt-1.5 flex flex-wrap items-end gap-2 rounded-md border bg-muted/30 p-2 text-xs">
      <div className="flex flex-col gap-0.5">
        <Label className="text-[10px] text-muted-foreground">เริ่ม</Label>
        <Input
          type="time"
          value={startVal}
          placeholder={clubStartPlaceholder}
          onChange={(e) => setStartVal(e.target.value)}
          className="h-7 w-[100px] text-xs"
        />
      </div>
      <div className="flex flex-col gap-0.5">
        <Label className="text-[10px] text-muted-foreground">เลิก</Label>
        <Input
          type="time"
          value={endVal}
          placeholder={clubEndPlaceholder}
          onChange={(e) => setEndVal(e.target.value)}
          className="h-7 w-[100px] text-xs"
        />
      </div>
      <div className="flex flex-col gap-0.5">
        <Label className="text-[10px] text-muted-foreground">เกมที่เล่น</Label>
        <Input
          type="number"
          min={0}
          max={500}
          value={games}
          onChange={(e) => setGames(Math.max(0, parseInt(e.target.value, 10) || 0))}
          className="h-7 w-[64px] text-xs [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        />
      </div>
      <div className="flex items-end gap-1 pb-0.5">
        <Button
          type="button"
          size="xs"
          disabled={pending}
          onClick={handleSave}
          className="h-7 text-xs"
        >
          {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : "บันทึก"}
        </Button>
        <Button
          type="button"
          size="xs"
          variant="ghost"
          className="h-7 text-xs"
          onClick={() => setOpen(false)}
        >
          ยกเลิก
        </Button>
      </div>
      {(clubStartPlaceholder || clubEndPlaceholder) && (
        <p className="w-full text-[10px] text-muted-foreground">
          ว่างไว้ = ใช้เวลาก๊วน ({clubStartPlaceholder}–{clubEndPlaceholder})
        </p>
      )}
    </div>
  );
}

// ─── Rename control (guests only, canManage only) ─────────────────────────────
// Pencil button renders inline in the main row; the edit form expands as a
// sub-row below it (same pattern as SessionEditor).

function RenameButton({ onOpen }: { onOpen: () => void }) {
  return (
    <Button
      size="xs"
      variant="ghost"
      className="text-muted-foreground h-6 w-6 p-0"
      onClick={onOpen}
      title="แก้ไขชื่อ"
      type="button"
    >
      <Pencil className="h-3 w-3" />
    </Button>
  );
}

function RenameForm({
  player,
  clubId,
  onClose,
}: {
  player: ClubPlayer;
  clubId: string;
  onClose: () => void;
}) {
  const router = useProgressRouter();
  const [value, setValue] = useState(player.display_name);
  const [pending, start] = useTransition();

  function handleSave() {
    const trimmed = value.trim();
    if (!trimmed) return;
    start(async () => {
      const res = await renameClubGuestAction(clubId, player.id, trimmed);
      if ("error" in res) {
        toast.error(res.error);
      } else {
        router.refresh();
        onClose();
      }
    });
  }

  return (
    <div className="mt-1.5 flex flex-wrap items-end gap-2 rounded-md border bg-muted/30 p-2 text-xs">
      <div className="flex flex-col gap-0.5 flex-1 min-w-[140px]">
        <Label className="text-[10px] text-muted-foreground">ชื่อ</Label>
        <Input
          autoFocus
          value={value}
          maxLength={60}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSave();
            if (e.key === "Escape") onClose();
          }}
          className="h-7 text-xs"
        />
      </div>
      <div className="flex items-end gap-1 pb-0.5">
        <Button
          type="button"
          size="xs"
          disabled={pending || !value.trim()}
          onClick={handleSave}
          className="h-7 text-xs"
        >
          {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : "บันทึก"}
        </Button>
        <Button
          type="button"
          size="xs"
          variant="ghost"
          className="h-7 text-xs"
          onClick={onClose}
        >
          ยกเลิก
        </Button>
      </div>
    </div>
  );
}

// ─── Shared row body (presentational — no useSortable) ───────────────────────
// Used by both SortableItem (active, draggable) and ReserveItem (static).

type RowBodyProps = {
  player: ClubPlayer;
  clubId: string;
  sessionProfileId: string | null;
  canManage: boolean;
  sessionStart?: string;
  sessionEnd?: string;
  levelById?: Map<string, { label: string }>;
  /** Drag handle element injected by SortableItem; null for reserve rows. */
  dragHandle?: React.ReactNode;
  /** Position label shown before the name (e.g. "1." or "#1"). */
  positionLabel: React.ReactNode;
};

function PlayerRowBody({
  player,
  clubId,
  sessionProfileId,
  canManage,
  sessionStart,
  sessionEnd,
  levelById,
  dragHandle,
  positionLabel,
}: RowBodyProps) {
  const isCheckedIn = !!player.checked_in_at;
  const isGuest = player.profile_id == null;
  // Require a non-null session: a public/anon viewer has sessionProfileId=null and
  // guest players have profile_id=null, so a bare `===` would render the self-only
  // LeaveButton on every guest row for anonymous viewers.
  const isSelf = sessionProfileId != null && sessionProfileId === player.profile_id;
  const [renameOpen, setRenameOpen] = useState(false);

  // Partial session: player's effective window differs from the club's full window.
  const cs = sessionStart?.slice(0, 5);
  const ce = sessionEnd?.slice(0, 5);
  const effStart = player.start_time?.slice(0, 5) ?? cs;
  const effEnd = player.end_time?.slice(0, 5) ?? ce;
  const isPartial = !!(cs && ce) && (effStart !== cs || effEnd !== ce);

  return (
    <>
      {/* Main row */}
      <div className="flex items-center gap-2">
        {dragHandle}
        <span className="text-muted-foreground w-6 tabular-nums">{positionLabel}</span>
        <span className="font-medium">{player.display_name}</span>
        {canManage && isGuest && (
          <RenameButton onOpen={() => setRenameOpen(true)} />
        )}
        {(() => {
          const label = player.level_id ? levelById?.get(player.level_id)?.label : undefined;
          return label ? <Badge variant="outline">{label}</Badge> : null;
        })()}
        {player.note && (
          <span className="text-muted-foreground text-xs hidden sm:inline">— {player.note}</span>
        )}

        <span className="ml-auto flex items-center gap-1.5">
          {canManage && (
            <SessionEditor
              player={player}
              clubId={clubId}
              sessionStart={sessionStart}
              sessionEnd={sessionEnd}
            />
          )}
          <CheckInButton player={player} clubId={clubId} canToggle={canManage} />
          {isSelf && <LeaveButton clubId={clubId} />}
          {canManage && !isSelf && <KickButton clubId={clubId} playerId={player.id} playerName={player.display_name} />}
        </span>
      </div>

      {/* Guest rename form — expands below main row */}
      {canManage && isGuest && renameOpen && (
        <RenameForm
          player={player}
          clubId={clubId}
          onClose={() => setRenameOpen(false)}
        />
      )}

      {/* Partial-session label under the name (shown to everyone) */}
      {isPartial && (
        <div className="flex items-center gap-1 pl-8 mt-0.5 text-[11px] text-muted-foreground tabular-nums">
          <Clock className="h-3 w-3 shrink-0" />
          เล่น {effStart}–{effEnd}
        </div>
      )}
    </>
  );
}

// ─── Sortable row (active players only) ──────────────────────────────────────

function SortableItem({
  player,
  index,
  clubId,
  sessionProfileId,
  canManage,
  sessionStart,
  sessionEnd,
  levelById,
}: {
  player: ClubPlayer;
  index: number;
  clubId: string;
  sessionProfileId: string | null;
  canManage: boolean;
  sessionStart?: string;
  sessionEnd?: string;
  levelById?: Map<string, { label: string }>;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: player.id,
    disabled: !canManage,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const isCheckedIn = !!player.checked_in_at;

  const dragHandle = canManage ? (
    <button
      {...attributes}
      {...listeners}
      className="flex h-9 w-9 -ml-1.5 items-center justify-center cursor-grab active:cursor-grabbing text-muted-foreground touch-none"
      aria-label="ลาก"
      type="button"
    >
      <GripVertical className="h-4 w-4" />
    </button>
  ) : null;

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={`flex flex-col border rounded px-3 py-2 bg-background transition-colors text-sm ${
        isCheckedIn ? "border-green-500/30 bg-green-500/5 dark:bg-green-500/5" : ""
      }`}
    >
      <PlayerRowBody
        player={player}
        clubId={clubId}
        sessionProfileId={sessionProfileId}
        canManage={canManage}
        sessionStart={sessionStart}
        sessionEnd={sessionEnd}
        levelById={levelById}
        dragHandle={dragHandle}
        positionLabel={`${index + 1}.`}
      />
    </li>
  );
}

// ─── Reserve row (draggable → drop into active list to promote) ───────────────

function ReserveItem({
  player,
  rank,
  clubId,
  sessionProfileId,
  canManage,
  sessionStart,
  sessionEnd,
  levelById,
}: {
  player: ClubPlayer;
  rank: number;
  clubId: string;
  sessionProfileId: string | null;
  canManage: boolean;
  sessionStart?: string;
  sessionEnd?: string;
  levelById?: Map<string, { label: string }>;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: player.id,
    disabled: !canManage,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 0.7,
  };

  const dragHandle = canManage ? (
    <button
      {...attributes}
      {...listeners}
      className="flex h-9 w-9 -ml-1.5 items-center justify-center cursor-grab active:cursor-grabbing text-muted-foreground touch-none"
      aria-label="ลากขึ้นเพื่อเป็นตัวจริง"
      type="button"
    >
      <GripVertical className="h-4 w-4" />
    </button>
  ) : null;

  return (
    <li
      ref={setNodeRef}
      style={style}
      className="flex flex-col border rounded px-3 py-2 bg-background text-sm"
    >
      <PlayerRowBody
        player={player}
        clubId={clubId}
        sessionProfileId={sessionProfileId}
        canManage={canManage}
        sessionStart={sessionStart}
        sessionEnd={sessionEnd}
        levelById={levelById}
        dragHandle={dragHandle}
        positionLabel={`#${rank}`}
      />
    </li>
  );
}

// ─── Active drop zone — wraps the active list so a dragged reserve has a target ─

/** Stable id for the active-list droppable zone (distinct from any player UUID). */
const ACTIVE_ZONE_ID = "__active_zone__";

function ActiveDropZone({
  highlight,
  dropDisabled,
  children,
}: {
  /** True while a reserve is being dragged — show the "drop here to promote" cue. */
  highlight: boolean;
  /**
   * Disable the zone droppable when active rows exist — dropping onto any active
   * row already promotes a reserve, and an always-on zone (whose rect spans the
   * whole list) would out-compete individual rows in closestCenter and silently
   * no-op active reorders. The zone is only the drop target when active is empty.
   */
  dropDisabled: boolean;
  children: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: ACTIVE_ZONE_ID, disabled: dropDisabled });
  // Affordance must match where a drop actually lands:
  //  - active empty (zone IS the droppable) → dashed "drop here" target + banner.
  //  - active has rows (zone disabled, rows are the targets) → only a subtle ring;
  //    a dashed "drop in this area" banner would be a false affordance, since a drop
  //    on the banner/padding resolves to the nearest row, not the zone.
  const showTarget = highlight && !dropDisabled;
  const showRing = highlight && dropDisabled;
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "rounded-md transition-colors",
        showTarget &&
          `border-2 border-dashed p-1 ${
            isOver ? "border-primary bg-primary/10" : "border-primary/40 bg-primary/5"
          }`,
        showRing && "ring-1 ring-primary/40",
      )}
    >
      {showTarget && (
        <p className="px-2 py-1 text-center text-[11px] font-medium text-primary">
          วางที่นี่เพื่อเลื่อนเป็นตัวจริง
        </p>
      )}
      {children}
    </div>
  );
}

// ─── Main list ────────────────────────────────────────────────────────────────

export function SortablePlayerList({
  clubId,
  players,
  sessionProfileId,
  canManage,
  levels,
  sessionStart,
  sessionEnd,
}: Props) {
  const levelById = levels
    ? new Map(levels.map((l) => [l.id, l]))
    : undefined;
  const [items, setItems] = useState(players);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const [refreshing, startRefresh] = useTransition();
  const dndId = useId();
  const router = useRouter();
  // True while an optimistic promote/reorder is in flight. The 30s auto-refresh
  // skips its tick during this window so a stale server snapshot can't revert the
  // optimistic state mid-action. (A ref, not state, so it doesn't churn `refresh`'s
  // identity and reset the interval.) Note: this only guards the timer — `players`
  // changing from any OTHER parent re-render still reconciles via the effect below.
  const mutatingRef = useRef(false);

  useEffect(() => { setItems(players); }, [players]);

  const refresh = useCallback(() => {
    if (mutatingRef.current) return;
    startRefresh(() => { router.refresh(); });
  }, [router]);

  useEffect(() => {
    const id = setInterval(refresh, 30_000);
    return () => clearInterval(id);
  }, [refresh]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  // Split into active and reserve; preserve relative order within each group.
  const active = items.filter((p) => p.status === "active");
  const reserve = items.filter((p) => p.status === "reserve");
  // A reserve is mid-drag → highlight the active list as the promote drop target.
  const draggingReserve = draggingId != null && reserve.some((p) => p.id === draggingId);

  function handleDragStart(event: DragStartEvent) {
    setDraggingId(String(event.active.id));
  }

  function handleDragEnd(event: DragEndEvent) {
    setDraggingId(null);
    const { active: dragActive, over } = event;
    if (!over) return;

    const draggedId = String(dragActive.id);
    const overId = String(over.id);
    const isReserveDragged = reserve.some((p) => p.id === draggedId);
    const overActive = overId === ACTIVE_ZONE_ID || active.some((p) => p.id === overId);

    // Reserve dragged into the active list → promote (admin override, ignores cap).
    if (isReserveDragged) {
      if (!overActive) return; // dropped back among reserves → no-op (cancel)
      // Optimistic: flip status; the filters re-derive active/reserve. The page
      // orders club_players by position ASC and the server promote keeps position,
      // so a reserve (joined-later → higher position) renders at the active tail on
      // both the optimistic array and the next server snapshot.
      setItems((prev) =>
        prev.map((p) => (p.id === draggedId ? { ...p, status: "active" } : p)),
      );
      mutatingRef.current = true;
      startTransition(async () => {
        try {
          const res = await promoteClubReserveAction({ clubId, playerId: draggedId });
          if ("error" in res) {
            toast.error(res.error);
            router.refresh(); // revert optimistic flip from server truth
          }
        } finally {
          mutatingRef.current = false;
        }
      });
      return;
    }

    // Active row reordered within the active list.
    if (draggedId === overId) return;
    const oldIndex = active.findIndex((p) => p.id === draggedId);
    const newIndex = active.findIndex((p) => p.id === overId);
    if (oldIndex === -1 || newIndex === -1) return; // dropped on zone/reserve → ignore
    const reorderedActive = arrayMove(active, oldIndex, newIndex);
    // Merge back: active first (reordered), reserves unchanged at tail.
    setItems([...reorderedActive, ...reserve]);
    mutatingRef.current = true;
    startTransition(async () => {
      try {
        // Requirement #3: pass ONLY active player ids.
        await reorderPlayersAction(clubId, reorderedActive.map((p) => p.id));
      } finally {
        mutatingRef.current = false;
      }
    });
  }

  const refreshBtn = (
    <Button
      variant="ghost"
      size="icon"
      className="h-7 w-7"
      onClick={refresh}
      disabled={refreshing}
      aria-label="รีเฟรชรายชื่อ"
    >
      <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
    </Button>
  );

  if (!items.length) {
    return (
      <div className="flex items-center gap-2">
        <p className="text-sm text-muted-foreground">ยังไม่มีคนลงชื่อ</p>
        {refreshBtn}
      </div>
    );
  }

  const checkedInCount = items.filter((p) => p.checked_in_at).length;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">อัพเดทอัตโนมัติทุก 30 วินาที</span>
          {checkedInCount > 0 && (
            <Badge
              variant="outline"
              className="text-xs text-green-600 dark:text-green-400 border-green-500/40 bg-green-500/10"
            >
              <CheckCircle2 className="h-3 w-3 mr-1" />
              {checkedInCount}/{items.length} พร้อม
            </Badge>
          )}
        </div>
        {refreshBtn}
      </div>

      {/* One DndContext over both lists so a reserve can be dragged up into the
          active list (→ promote) as well as active rows reordered among themselves. */}
      <DndContext
        id={dndId}
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setDraggingId(null)}
      >
        {/* Active players — drag-reorderable; also the drop target to promote a reserve */}
        <ActiveDropZone highlight={draggingReserve} dropDisabled={active.length > 0}>
          <SortableContext items={active.map((p) => p.id)} strategy={verticalListSortingStrategy}>
            <ol className="space-y-1">
              {active.length === 0 ? (
                <li className="rounded border border-dashed px-3 py-3 text-center text-xs text-muted-foreground">
                  ยังไม่มีตัวจริง
                </li>
              ) : (
                active.map((p, i) => (
                  <SortableItem
                    key={p.id}
                    player={p}
                    index={i}
                    clubId={clubId}
                    sessionProfileId={sessionProfileId}
                    canManage={canManage}
                    sessionStart={sessionStart}
                    sessionEnd={sessionEnd}
                    levelById={levelById}
                  />
                ))
              )}
            </ol>
          </SortableContext>
        </ActiveDropZone>

        {/* Reserve players — drag up into the active list to promote */}
        {reserve.length > 0 && (
          <div className="mt-3 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-muted-foreground">สำรอง ({reserve.length})</span>
              <Badge variant="secondary" className="text-xs">รอคิว</Badge>
              {canManage && (
                <span className="text-[11px] text-muted-foreground">ลากขึ้นเพื่อเลื่อนเป็นตัวจริง</span>
              )}
            </div>
            <SortableContext items={reserve.map((p) => p.id)} strategy={verticalListSortingStrategy}>
              <ol className="space-y-1">
                {reserve.map((p, i) => (
                  <ReserveItem
                    key={p.id}
                    player={p}
                    rank={i + 1}
                    clubId={clubId}
                    sessionProfileId={sessionProfileId}
                    canManage={canManage}
                    sessionStart={sessionStart}
                    sessionEnd={sessionEnd}
                    levelById={levelById}
                  />
                ))}
              </ol>
            </SortableContext>
          </div>
        )}
      </DndContext>
    </div>
  );
}
