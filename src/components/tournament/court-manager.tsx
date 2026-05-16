"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, GripVertical, Trash2, Loader2 } from "lucide-react";
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { updateCourtsAction } from "@/lib/actions/tournaments";

type Props = {
  tournamentId: string;
  initialCourts: string[];
};

export function CourtManager({ tournamentId, initialCourts }: Props) {
  const router = useRouter();
  const [courts, setCourts] = useState<string[]>(initialCourts);
  const [newName, setNewName] = useState("");
  const [savePending, startSave] = useTransition();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const save = (next: string[]) => {
    startSave(async () => {
      const res = await updateCourtsAction(tournamentId, next);
      if (res && "error" in res) {
        toast.error(res.error);
        setCourts(initialCourts);
      } else {
        toast.success("บันทึกรายการสนามแล้ว");
        setCourts(res.courts);
        router.refresh();
      }
    });
  };

  const add = () => {
    const name = newName.trim();
    if (!name) return;
    if (courts.includes(name)) {
      toast.error("ชื่อสนามซ้ำ");
      return;
    }
    const next = [...courts, name];
    setCourts(next);
    setNewName("");
    save(next);
  };

  const remove = (name: string) => {
    const next = courts.filter((c) => c !== name);
    setCourts(next);
    save(next);
  };

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = courts.indexOf(active.id as string);
    const newIndex = courts.indexOf(over.id as string);
    if (oldIndex < 0 || newIndex < 0) return;
    const next = arrayMove(courts, oldIndex, newIndex);
    setCourts(next);
    save(next);
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          จัดการสนาม
          {savePending && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0 space-y-3">
        {courts.length === 0 ? (
          <p className="text-sm text-muted-foreground">ยังไม่มีสนาม — เพิ่มได้ด้านล่าง</p>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={courts} strategy={verticalListSortingStrategy}>
              <ul className="space-y-1.5">
                {courts.map((name) => (
                  <SortableCourtRow key={name} name={name} onRemove={() => remove(name)} disabled={savePending} />
                ))}
              </ul>
            </SortableContext>
          </DndContext>
        )}

        <div className="flex gap-2">
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
            placeholder="ชื่อสนาม เช่น สนาม 1"
            className="h-8 text-sm"
            disabled={savePending}
          />
          <Button size="sm" onClick={add} disabled={savePending || !newName.trim()}>
            <Plus className="h-3.5 w-3.5 mr-1" />เพิ่ม
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function SortableCourtRow({
  name,
  onRemove,
  disabled,
}: {
  name: string;
  onRemove: () => void;
  disabled: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: name });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-2 px-2 py-1.5 rounded-md border bg-card touch-none"
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        aria-label="ลากเพื่อจัดลำดับ"
        className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground touch-none"
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <span className="flex-1 text-sm">{name}</span>
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label={`ลบ ${name}`}
        className="text-destructive hover:text-destructive"
        onClick={onRemove}
        disabled={disabled}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </li>
  );
}
