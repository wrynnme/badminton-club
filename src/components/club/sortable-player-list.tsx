"use client";

import { useState, useTransition, useId, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
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
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { LeaveButton } from "@/components/club/leave-button";
import { KickButton } from "@/components/club/kick-button";
import { reorderPlayersAction, toggleCheckInAction, updateClubPlayerSessionAction } from "@/lib/actions/clubs";
import type { ClubPlayer } from "@/lib/types";

type Props = {
  clubId: string;
  players: ClubPlayer[];
  sessionProfileId: string | null;
  canManage: boolean;
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
  const router = useRouter();
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
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();

  const clubStartPlaceholder = sessionStart?.slice(0, 5) ?? "";
  const clubEndPlaceholder = sessionEnd?.slice(0, 5) ?? "";

  // Pre-fill with the player's override, else the club's full window (not blank).
  const [startVal, setStartVal] = useState(player.start_time?.slice(0, 5) ?? clubStartPlaceholder);
  const [endVal, setEndVal] = useState(player.end_time?.slice(0, 5) ?? clubEndPlaceholder);
  const [games, setGames] = useState(player.games_played);

  // Keep in sync if parent re-renders with new player data
  useEffect(() => {
    setStartVal(player.start_time?.slice(0, 5) ?? clubStartPlaceholder);
    setEndVal(player.end_time?.slice(0, 5) ?? clubEndPlaceholder);
    setGames(player.games_played);
  }, [player.start_time, player.end_time, player.games_played, clubStartPlaceholder, clubEndPlaceholder]);

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

// ─── Sortable row ─────────────────────────────────────────────────────────────

function SortableItem({
  player,
  index,
  clubId,
  sessionProfileId,
  canManage,
  sessionStart,
  sessionEnd,
}: {
  player: ClubPlayer;
  index: number;
  clubId: string;
  sessionProfileId: string | null;
  canManage: boolean;
  sessionStart?: string;
  sessionEnd?: string;
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

  const isSelf = sessionProfileId === player.profile_id;
  const isCheckedIn = !!player.checked_in_at;

  // Partial session: player's effective window differs from the club's full window.
  const cs = sessionStart?.slice(0, 5);
  const ce = sessionEnd?.slice(0, 5);
  const effStart = player.start_time?.slice(0, 5) ?? cs;
  const effEnd = player.end_time?.slice(0, 5) ?? ce;
  const isPartial = !!(cs && ce) && (effStart !== cs || effEnd !== ce);

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={`flex flex-col border rounded px-3 py-2 bg-background transition-colors text-sm ${
        isCheckedIn ? "border-green-500/30 bg-green-500/5 dark:bg-green-500/5" : ""
      }`}
    >
      {/* Main row */}
      <div className="flex items-center gap-2">
        {canManage && (
          <button
            {...attributes}
            {...listeners}
            className="cursor-grab active:cursor-grabbing text-muted-foreground touch-none"
            aria-label="ลาก"
            type="button"
          >
            <GripVertical className="h-4 w-4" />
          </button>
        )}
        <span className="text-muted-foreground w-6 tabular-nums">{index + 1}.</span>
        <span className="font-medium">{player.display_name}</span>
        {player.level && <Badge variant="outline">{player.level}</Badge>}
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

      {/* Partial-session label under the name (shown to everyone) */}
      {isPartial && (
        <div className="flex items-center gap-1 pl-8 mt-0.5 text-[11px] text-muted-foreground tabular-nums">
          <Clock className="h-3 w-3 shrink-0" />
          เล่น {effStart}–{effEnd}
        </div>
      )}
    </li>
  );
}

// ─── Main list ────────────────────────────────────────────────────────────────

export function SortablePlayerList({
  clubId,
  players,
  sessionProfileId,
  canManage,
  sessionStart,
  sessionEnd,
}: Props) {
  const [items, setItems] = useState(players);
  const [, startTransition] = useTransition();
  const [refreshing, startRefresh] = useTransition();
  const dndId = useId();
  const router = useRouter();

  useEffect(() => { setItems(players); }, [players]);

  const refresh = useCallback(() => {
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

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = items.findIndex((p) => p.id === active.id);
    const newIndex = items.findIndex((p) => p.id === over.id);
    const reordered = arrayMove(items, oldIndex, newIndex);
    setItems(reordered);
    startTransition(async () => {
      await reorderPlayersAction(clubId, reordered.map((p) => p.id));
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

      <DndContext
        id={dndId}
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={items.map((p) => p.id)} strategy={verticalListSortingStrategy}>
          <ol className="space-y-1">
            {items.map((p, i) => (
              <SortableItem
                key={p.id}
                player={p}
                index={i}
                clubId={clubId}
                sessionProfileId={sessionProfileId}
                canManage={canManage}
                sessionStart={sessionStart}
                sessionEnd={sessionEnd}
              />
            ))}
          </ol>
        </SortableContext>
      </DndContext>
    </div>
  );
}
