"use client";

import { useState, useTransition, useId, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import { GripVertical } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { LeaveButton } from "@/components/club/leave-button";
import { KickButton } from "@/components/club/kick-button";
import { reorderPlayersAction } from "@/lib/actions/clubs";
import type { ClubPlayer } from "@/lib/types";

type Props = {
  clubId: string;
  players: ClubPlayer[];
  sessionProfileId: string | null;
  isOwner: boolean;
};

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

  return (
    <li
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-2 text-sm border rounded px-3 py-2 bg-background"
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
      <span className="text-muted-foreground w-6">{index + 1}.</span>
      <span className="font-medium">{player.display_name}</span>
      {player.level && <Badge variant="outline">{player.level}</Badge>}
      {player.note && <span className="text-muted-foreground text-xs">— {player.note}</span>}
      <span className="ml-auto flex items-center">
        {sessionProfileId === player.profile_id && <LeaveButton clubId={clubId} />}
        {isOwner && sessionProfileId !== player.profile_id && (
          <KickButton clubId={clubId} playerId={player.id} />
        )}
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

  useEffect(() => {
    setItems(players);
  }, [players]);

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

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">อัพเดทอัตโนมัติทุก 30 วินาที</span>
        {refreshBtn}
      </div>
    <DndContext id={dndId} sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
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
