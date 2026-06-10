"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "@bprogress/next/app";
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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { updateClubCourtsAction, renameClubCourtAction } from "@/lib/actions/clubs";

type Props = {
  clubId: string;
  initialCourts: string[];
};

export function ClubCourtManager({ clubId, initialCourts }: Props) {
  const router = useRouter();
  const [courts, setCourts] = useState<string[]>(initialCourts);
  const [newName, setNewName] = useState("");
  const [savePending, startSave] = useTransition();
  const [dragging, setDragging] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightRef = useRef<Promise<unknown> | null>(null);
  // Last known persisted state — used to roll back on save failure.
  const lastSavedRef = useRef<string[]>(initialCourts);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // Serialize behind any in-flight write, apply optimistic result on success or
  // roll back to the last persisted state on error. successMsg can be a plain
  // string (array save) or derive the toast from the result (rename → moved count).
  type SaveOk = { courts: string[]; movedMatches?: number };
  const runSave = (
    action: () => Promise<SaveOk | { error: string }>,
    successMsg: string | ((res: SaveOk) => string),
  ) => {
    startSave(async () => {
      if (inFlightRef.current) {
        try { await inFlightRef.current; } catch {}
      }
      const p = action();
      inFlightRef.current = p;
      const res = await p;
      inFlightRef.current = null;
      if (res && "error" in res) {
        toast.error(res.error);
        setCourts(lastSavedRef.current);
      } else {
        toast.success(typeof successMsg === "function" ? successMsg(res) : successMsg);
        setCourts(res.courts);
        lastSavedRef.current = res.courts;
        router.refresh();
      }
    });
  };

  // Debounce + serialize: rapid edits collapse into one save, and a new save
  // waits for the previous to finish so writes can't overtake each other.
  const save = (next: string[]) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      runSave(() => updateClubCourtsAction(clubId, next), "บันทึกรายการสนามแล้ว");
    }, 250);
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

  // Rename goes through a dedicated action (not the whole-array save) so the
  // server can cascade the new name onto club_matches.court. Optimistic + rollback,
  // serialized behind any in-flight save like the array path.
  const rename = (oldName: string, rawNew: string) => {
    const newName = rawNew.trim();
    if (!newName || newName === oldName) return;
    if (courts.includes(newName)) {
      toast.error("ชื่อสนามซ้ำ");
      return;
    }
    // Cancel any pending debounced array-save: it holds a PRE-rename snapshot and
    // would otherwise land after this rename and revert clubs.courts to the old
    // name while club_matches.court keeps the new one (orphaning matches).
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setCourts((prev) => prev.map((c) => (c === oldName ? newName : c)));
    runSave(
      () => renameClubCourtAction(clubId, oldName, newName),
      (res) =>
        res.movedMatches && res.movedMatches > 0
          ? `เปลี่ยนชื่อสนามแล้ว (ย้าย ${res.movedMatches} แมตช์)`
          : "เปลี่ยนชื่อสนามแล้ว",
    );
  };

  const onDragEnd = (event: DragEndEvent) => {
    setDragging(false);
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
          <DndContext id="club-court-manager-dnd" sensors={sensors} collisionDetection={closestCenter} onDragStart={() => setDragging(true)} onDragEnd={onDragEnd}>
            <SortableContext items={courts} strategy={verticalListSortingStrategy}>
              <ul className="space-y-1.5">
                {courts.map((name) => (
                  <SortableCourtRow
                    key={name}
                    name={name}
                    onRename={rename}
                    onRemove={() => remove(name)}
                    disabled={savePending || dragging}
                  />
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
            placeholder="ชื่อสนาม เช่น 1 หรือ A"
            maxLength={40}
            className="h-8 text-sm"
            disabled={savePending}
          />
          <Tooltip>
            <TooltipTrigger
              render={
                <Button size="sm" onClick={add} disabled={savePending || !newName.trim()}>
                  <Plus className="h-3.5 w-3.5 mr-1" />เพิ่ม
                </Button>
              }
            />
            <TooltipContent>เพิ่มสนามใหม่ในรายการ</TooltipContent>
          </Tooltip>
        </div>
      </CardContent>
    </Card>
  );
}

function SortableCourtRow({
  name,
  onRename,
  onRemove,
  disabled,
}: {
  name: string;
  onRename: (oldName: string, newName: string) => void;
  onRemove: () => void;
  disabled: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: name });
  const [value, setValue] = useState(name);
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };

  // Commit on Enter/blur; revert to the current name on empty/unchanged.
  const commit = () => {
    const v = value.trim();
    if (!v || v === name) {
      setValue(name);
      return;
    }
    onRename(name, v);
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-2 px-2 py-1.5 rounded-md border bg-card touch-none"
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              {...attributes}
              {...listeners}
              aria-label="ลากเพื่อจัดลำดับ"
              className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground touch-none"
            >
              <GripVertical className="h-4 w-4" />
            </button>
          }
        />
        <TooltipContent>ลากเพื่อจัดลำดับ</TooltipContent>
      </Tooltip>
      <span className="text-sm text-muted-foreground shrink-0">สนาม</span>
      <Tooltip>
        <TooltipTrigger
          render={
            <Input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  e.currentTarget.blur();
                } else if (e.key === "Escape") {
                  setValue(name);
                  e.currentTarget.blur();
                }
              }}
              maxLength={40}
              disabled={disabled}
              aria-label={`ชื่อสนาม ${name}`}
              className="h-7 text-sm flex-1 min-w-0"
            />
          }
        />
        <TooltipContent>แก้ชื่อแล้วกด Enter เพื่อเปลี่ยนชื่อสนาม</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger
          render={
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
          }
        />
        <TooltipContent>ลบสนาม &quot;{name}&quot;</TooltipContent>
      </Tooltip>
    </li>
  );
}
