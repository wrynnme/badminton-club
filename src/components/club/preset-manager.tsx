"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
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
  Wallet,
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
  const t = useTranslations("club.presetManager");
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

  // ── Helpers (need t()) ──────────────────────────────────────────────────────

  function presetSummary(preset: ClubPreset) {
    const c = preset.config;
    const parts: string[] = [];
    if (c.max_players) parts.push(t("playerSuffix", { count: c.max_players }));
    if (c.court_count) parts.push(t("courtSuffix", { count: c.court_count }));
    return parts.join(" · ");
  }

  function paymentSummary(preset: ClubPreset) {
    const c = preset.config;
    const parts: string[] = [];
    if (c.promptpay_id || c.promptpay_qr_image) parts.push(t("paymentPromptPay"));
    if (c.receipt_template.payment_show.bank) parts.push(t("paymentBank"));
    if (parts.length === 0) return null;
    return parts.join(" · ");
  }

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
    toast.success(t("toastApplied", { name: preset.name }));
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
    toast.success(t("toastDeleted", { name: deleteTarget.name }));
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
          {t("heading")}
        </h2>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button variant="outline" size="sm" onClick={openCreate}>
                <Plus className="h-3.5 w-3.5 mr-1" />
                {t("createButton")}
              </Button>
            }
          />
          <TooltipContent>{t("createTooltip")}</TooltipContent>
        </Tooltip>
      </div>

      {/* Empty state */}
      {presets.length === 0 ? (
        <p className="text-sm text-muted-foreground py-2">
          {t("empty")}
        </p>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {presets.map((preset) => {
            const isApplying = applyingId === preset.id;
            const isDeleting = deletingId === preset.id;
            const summary = presetSummary(preset);
            const payment = paymentSummary(preset);
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
                      <p className="pl-0.5">{t("regularCount", { count: regularCount })}</p>
                    )}
                    {payment && (
                      <div className="flex items-center gap-1.5">
                        <Wallet className="h-3 w-3 shrink-0" />
                        <span>{payment}</span>
                      </div>
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
                                {t("applying")}
                              </>
                            ) : (
                              <>
                                <Play className="h-3.5 w-3.5 mr-1" />
                                {t("applyButton")}
                              </>
                            )}
                          </Button>
                        }
                      />
                      <TooltipContent>
                        {t("applyTooltip")}
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
                            aria-label={t("editAriaLabel")}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                        }
                      />
                      <TooltipContent>{t("editTooltip")}</TooltipContent>
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
                            aria-label={t("deleteAriaLabel")}
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
                      <TooltipContent>{t("deleteTooltip")}</TooltipContent>
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
            <DialogTitle>{t("deleteDialogTitle")}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {t("deleteDialogBody", { name: deleteTarget?.name ?? "" })}
          </p>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteOpen(false)}
              disabled={!!deletingId}
            >
              {t("deleteDialogCancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={!!deletingId}
            >
              {deletingId ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  {t("deleting")}
                </>
              ) : (
                t("deleteDialogConfirm")
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
