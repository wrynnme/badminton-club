"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Plus,
  Play,
  Pencil,
  Trash2,
  Loader2,
  CalendarDays,
  MapPin,
  Users,
  LayoutGrid,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { PresetFormDialog } from "@/components/club/preset-form";
import {
  applyClubPresetAction,
  deleteClubPresetAction,
} from "@/lib/actions/club-presets";
import type { ClubPreset } from "@/lib/types";

// ── Props ─────────────────────────────────────────────────────────────────────

type Props = {
  presets: ClubPreset[];
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function presetSummary(preset: ClubPreset) {
  const c = preset.config;
  const parts: string[] = [];
  if (c.max_players) parts.push(`${c.max_players} คน`);
  if (c.court_count) parts.push(`${c.court_count} สนาม`);
  return parts.join(" · ");
}

function timeRange(preset: ClubPreset) {
  const { start_time, end_time } = preset.config;
  if (!start_time && !end_time) return null;
  const s = start_time ? start_time.slice(0, 5) : "";
  const e = end_time ? end_time.slice(0, 5) : "";
  if (s && e) return `${s}–${e}`;
  return s || e;
}

// ── Main component ────────────────────────────────────────────────────────────

export function PresetManager({ presets }: Props) {
  const router = useRouter();

  // Form dialog state
  const [formOpen, setFormOpen] = useState(false);
  const [editingPreset, setEditingPreset] = useState<ClubPreset | undefined>();

  // Delete confirm dialog state
  const [deleteTarget, setDeleteTarget] = useState<ClubPreset | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);

  // Per-preset action pending states
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  // ── Handlers ────────────────────────────────────────────────────────────────

  function openCreate() {
    setEditingPreset(undefined);
    setFormOpen(true);
  }

  function openEdit(preset: ClubPreset) {
    setEditingPreset(preset);
    setFormOpen(true);
  }

  function openDeleteConfirm(preset: ClubPreset) {
    setDeleteTarget(preset);
    setDeleteOpen(true);
  }

  async function handleApply(preset: ClubPreset) {
    setApplyingId(preset.id);
    const res = await applyClubPresetAction(preset.id);
    setApplyingId(null);
    if ("error" in res) {
      toast.error(res.error);
      return;
    }
    toast.success(`เปิดก๊วนจากพรีเซ็ต "${preset.name}" แล้ว`);
    router.push(`/clubs/${res.clubId}`);
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeletingId(deleteTarget.id);
    const res = await deleteClubPresetAction(deleteTarget.id);
    setDeletingId(null);
    setDeleteOpen(false);
    if ("error" in res) {
      toast.error(res.error);
      return;
    }
    toast.success(`ลบพรีเซ็ต "${deleteTarget.name}" แล้ว`);
    startTransition(() => router.refresh());
    setDeleteTarget(null);
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-3">
      {/* Header row */}
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold flex items-center gap-1.5">
          <LayoutGrid className="h-4 w-4 text-muted-foreground" />
          พรีเซ็ตก๊วน
        </h2>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button variant="outline" size="sm" onClick={openCreate}>
                <Plus className="h-3.5 w-3.5 mr-1" />
                สร้างพรีเซ็ต
              </Button>
            }
          />
          <TooltipContent>บันทึกตั้งค่าก๊วนประจำไว้ใช้ซ้ำ</TooltipContent>
        </Tooltip>
      </div>

      {/* Empty state */}
      {presets.length === 0 ? (
        <p className="text-sm text-muted-foreground py-2">
          ยังไม่มีพรีเซ็ต — สร้างพรีเซ็ตเพื่อเปิดก๊วนซ้ำได้เร็วขึ้น
        </p>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {presets.map((preset) => {
            const isApplying = applyingId === preset.id;
            const isDeleting = deletingId === preset.id;
            const summary = presetSummary(preset);
            const time = timeRange(preset);
            const regularCount = preset.config.regulars?.length ?? 0;

            return (
              <Card key={preset.id} className="relative">
                <CardContent className="pt-4 pb-3 space-y-2">
                  {/* Name */}
                  <p className="font-medium text-sm leading-tight line-clamp-1 pr-2">
                    {preset.name}
                  </p>

                  {/* Metadata rows */}
                  <div className="space-y-1 text-xs text-muted-foreground">
                    {preset.config.venue && (
                      <div className="flex items-center gap-1.5">
                        <MapPin className="h-3 w-3 shrink-0" />
                        <span className="line-clamp-1">{preset.config.venue}</span>
                      </div>
                    )}
                    {(preset.config.schedule_day || time) && (
                      <div className="flex items-center gap-1.5">
                        <CalendarDays className="h-3 w-3 shrink-0" />
                        <span>
                          {[preset.config.schedule_day, time]
                            .filter(Boolean)
                            .join(" ")}
                        </span>
                      </div>
                    )}
                    {summary && (
                      <div className="flex items-center gap-1.5">
                        <Users className="h-3 w-3 shrink-0" />
                        <span>{summary}</span>
                      </div>
                    )}
                    {regularCount > 0 && (
                      <p className="pl-0.5">{regularCount} ผู้เล่นประจำ</p>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1.5 pt-1">
                    {/* เปิดก๊วน */}
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <Button
                            size="sm"
                            className="flex-1"
                            disabled={isApplying || isDeleting}
                            onClick={() => handleApply(preset)}
                          >
                            {isApplying ? (
                              <>
                                <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                                กำลังเปิด...
                              </>
                            ) : (
                              <>
                                <Play className="h-3.5 w-3.5 mr-1" />
                                เปิดก๊วน
                              </>
                            )}
                          </Button>
                        }
                      />
                      <TooltipContent>
                        สร้างก๊วนรอบใหม่จากพรีเซ็ตนี้
                      </TooltipContent>
                    </Tooltip>

                    {/* แก้ไข */}
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <Button
                            variant="outline"
                            size="icon-sm"
                            disabled={isApplying || isDeleting}
                            onClick={() => openEdit(preset)}
                            aria-label="แก้ไขพรีเซ็ต"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                        }
                      />
                      <TooltipContent>แก้ไขพรีเซ็ต</TooltipContent>
                    </Tooltip>

                    {/* ลบ */}
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            disabled={isApplying || isDeleting}
                            onClick={() => openDeleteConfirm(preset)}
                            aria-label="ลบพรีเซ็ต"
                            className="text-destructive hover:text-destructive hover:bg-destructive/10"
                          >
                            {isDeleting ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Trash2 className="h-3.5 w-3.5" />
                            )}
                          </Button>
                        }
                      />
                      <TooltipContent>ลบพรีเซ็ตถาวร</TooltipContent>
                    </Tooltip>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Create / Edit dialog */}
      <PresetFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        preset={editingPreset}
      />

      {/* Delete confirm dialog */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>ลบพรีเซ็ต</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            ลบ{" "}
            <span className="font-medium text-foreground">
              &ldquo;{deleteTarget?.name}&rdquo;
            </span>{" "}
            ถาวร ก๊วนที่เปิดไปแล้วจากพรีเซ็ตนี้จะไม่ได้รับผลกระทบ
          </p>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteOpen(false)}
              disabled={!!deletingId}
            >
              ยกเลิก
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={!!deletingId}
            >
              {deletingId ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  กำลังลบ...
                </>
              ) : (
                "ลบพรีเซ็ต"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
