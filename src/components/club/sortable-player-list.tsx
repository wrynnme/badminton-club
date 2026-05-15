"use client";

import { useState, useTransition, useId, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, GripVertical, CheckCircle2, Circle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import { reorderPlayersAction, toggleCheckInAction } from "@/lib/actions/clubs";
import type { ClubPlayer } from "@/lib/types";

type Props = {
  clubId: string;
  players: ClubPlayer[];
  sessionProfileId: string | null;
  isOwner: boolean;
};

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

function SortableItem({
  player,
  index,
  clubId,
  sessionProfileId,
  isOwner,
}: {
  player: ClubPlayer;
  index: number;
  clubId: string;
  sessionProfileId: string | null;
  isOwner: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: player.id,
    disabled: !isOwner,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const isSelf = sessionProfileId === player.profile_id;
  const canToggleCheckIn = isOwner || isSelf;
  const isCheckedIn = !!player.checked_in_at;

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-2 text-sm border rounded px-3 py-2 bg-background transition-colors ${
        isCheckedIn ? "border-green-500/30 bg-green-500/5 dark:bg-green-500/5" : ""
      }`}
    >
      {isOwner && (
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
        <CheckInButton player={player} clubId={clubId} canToggle={canToggleCheckIn} />
        {isSelf && <LeaveButton clubId={clubId} />}
        {isOwner && !isSelf && <KickButton clubId={clubId} playerId={player.id} />}
      </span>
    </li>
  );
}

export function SortablePlayerList({ clubId, players, sessionProfileId, isOwner }: Props) {
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
                isOwner={isOwner}
              />
            ))}
          </ol>
        </SortableContext>
      </DndContext>
    </div>
  );
}
