"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Pencil, Trash2, Check, X, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  createLevelAction,
  updateLevelAction,
  deleteLevelAction,
} from "@/lib/actions/clubs";
import type { Level } from "@/lib/types";

type Props = {
  levels: Level[];
};

// ─── Inline edit row ──────────────────────────────────────────────────────────

function EditRow({
  level,
  onDone,
}: {
  level: Level;
  onDone: () => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [real, setReal] = useState(String(level.real));
  const [label, setLabel] = useState(level.label);

  function handleSave() {
    const realNum = parseFloat(real);
    if (!Number.isFinite(realNum)) {
      toast.error("real ต้องเป็นตัวเลข");
      return;
    }
    if (!label.trim()) {
      toast.error("ระบุชื่อระดับ");
      return;
    }
    start(async () => {
      const res = await updateLevelAction({ id: level.id, real: realNum, label: label.trim() });
      if ("error" in res) {
        toast.error(res.error);
      } else {
        router.refresh();
        onDone();
      }
    });
  }

  return (
    <div className="flex items-center gap-2 py-1">
      <Input
        type="number"
        step="0.5"
        min={0}
        max={100}
        value={real}
        onChange={(e) => setReal(e.target.value)}
        className="h-7 w-20 text-sm"
        aria-label="real value"
      />
      <Input
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        className="h-7 flex-1 text-sm"
        aria-label="label"
        onKeyDown={(e) => {
          if (e.key === "Enter") handleSave();
          if (e.key === "Escape") onDone();
        }}
      />
      <Tooltip>
        <TooltipTrigger render={
          <Button size="xs" disabled={pending} onClick={handleSave}>
            <Check className="h-3.5 w-3.5" />
          </Button>
        } />
        <TooltipContent>บันทึก</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger render={
          <Button size="xs" variant="ghost" disabled={pending} onClick={onDone}>
            <X className="h-3.5 w-3.5" />
          </Button>
        } />
        <TooltipContent>ยกเลิก</TooltipContent>
      </Tooltip>
    </div>
  );
}

// ─── Level row (read mode) ────────────────────────────────────────────────────

function LevelRow({ level }: { level: Level }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pending, start] = useTransition();

  if (editing) {
    return <EditRow level={level} onDone={() => setEditing(false)} />;
  }

  function handleDelete() {
    start(async () => {
      const res = await deleteLevelAction(level.id);
      if ("error" in res) {
        toast.error(res.error);
      } else {
        router.refresh();
      }
      setConfirmDelete(false);
    });
  }

  return (
    <div className="flex items-center gap-2 py-1 text-sm">
      <span className="font-medium w-8 tabular-nums text-right">{level.real}</span>
      <span className="flex-1">{level.label}</span>

      {confirmDelete ? (
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-destructive">ลบ?</span>
          <Button
            size="xs"
            variant="destructive"
            disabled={pending}
            onClick={handleDelete}
          >
            ยืนยัน
          </Button>
          <Button
            size="xs"
            variant="ghost"
            disabled={pending}
            onClick={() => setConfirmDelete(false)}
          >
            ยกเลิก
          </Button>
        </div>
      ) : (
        <>
          <Tooltip>
            <TooltipTrigger render={
              <Button
                size="xs"
                variant="ghost"
                className="h-6 w-6 p-0"
                onClick={() => setEditing(true)}
              >
                <Pencil className="h-3.5 w-3.5" />
              </Button>
            } />
            <TooltipContent>แก้ไขระดับ</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger render={
              <Button
                size="xs"
                variant="ghost"
                className="h-6 w-6 p-0 text-destructive hover:text-destructive"
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            } />
            <TooltipContent>ลบระดับ — ผู้เล่นที่ใช้ระดับนี้จะกลายเป็นไม่ระบุ</TooltipContent>
          </Tooltip>
        </>
      )}
    </div>
  );
}

// ─── Add row ──────────────────────────────────────────────────────────────────

function AddRow() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [real, setReal] = useState("");
  const [label, setLabel] = useState("");

  function handleAdd() {
    const realNum = parseFloat(real);
    if (!Number.isFinite(realNum)) {
      toast.error("real ต้องเป็นตัวเลข");
      return;
    }
    if (!label.trim()) {
      toast.error("ระบุชื่อระดับ");
      return;
    }
    start(async () => {
      const res = await createLevelAction({ real: realNum, label: label.trim() });
      if ("error" in res) {
        toast.error(res.error);
      } else {
        setReal("");
        setLabel("");
        router.refresh();
      }
    });
  }

  return (
    <div className="flex items-center gap-2 pt-3 border-t mt-2">
      <Input
        type="number"
        step="0.5"
        min={0}
        max={100}
        value={real}
        onChange={(e) => setReal(e.target.value)}
        placeholder="real"
        className="h-7 w-20 text-sm"
        aria-label="real value สำหรับระดับใหม่"
      />
      <Input
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        placeholder="ชื่อระดับ เช่น N"
        className="h-7 flex-1 text-sm"
        aria-label="ชื่อระดับใหม่"
        onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); }}
      />
      <Tooltip>
        <TooltipTrigger render={
          <Button size="xs" disabled={pending} onClick={handleAdd}>
            <Plus className="h-3.5 w-3.5 mr-1" />
            เพิ่ม
          </Button>
        } />
        <TooltipContent>เพิ่มระดับใหม่</TooltipContent>
      </Tooltip>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function ClubLevelsManager({ levels }: Props) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">ระดับฝีมือ (Levels)</CardTitle>
        <p className="text-xs text-muted-foreground">
          ใช้ร่วมกันทุกก๊วน — real = ค่าตัวเลขสำหรับคำนวณ, label = ชื่อที่แสดง
        </p>
      </CardHeader>
      <CardContent className="space-y-0.5">
        {levels.length === 0 && (
          <p className="text-sm text-muted-foreground py-1">ยังไม่มีระดับ — เพิ่มด้านล่าง</p>
        )}
        {levels.map((l) => (
          <LevelRow key={l.id} level={l} />
        ))}
        <AddRow />
        <p className="text-[11px] text-muted-foreground pt-1">
          ลบแล้วผู้เล่นที่ใช้ระดับนี้จะกลายเป็นไม่ระบุ
        </p>
      </CardContent>
    </Card>
  );
}
