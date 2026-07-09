"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useForm } from "@tanstack/react-form";
import * as z from "zod";
import { toast } from "sonner";
import { RotateCcw, Shuffle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { fieldErrors } from "@/lib/form-errors";
import {
  generateClubQueueAction,
  regenerateClubQueueAction,
} from "@/lib/actions/club-matches";
import { buildPreviewRows, type PreviewPlayer } from "@/lib/club/queue-preview";
import { suggestBatchTarget } from "@/lib/club/batch-queue";
import type { ClubMatch } from "@/lib/types";

export function GenerateQueueDialog({
  clubId,
  players,
  matches,
  clubStart,
  clubEnd,
  playersPerTeam,
  onRefresh,
}: {
  clubId: string;
  players: PreviewPlayer[];
  matches: ClubMatch[];
  clubStart: string;
  clubEnd: string;
  playersPerTeam: 1 | 2;
  onRefresh: () => void;
}) {
  const t = useTranslations("club.queuePanel");
  const [open, setOpen] = useState(false);
  const [confirmingReroll, setConfirmingReroll] = useState(false);
  const [busy, startTransition] = useTransition();

  const activePlayers = useMemo(
    () => players.filter((p) => p.status === "active"),
    [players],
  );

  // Eligible = checked-in players when anyone has checked in, else the whole active
  // roster (mirrors the check-in hard gate in loadClubQueueContext / queue-preview).
  const eligibleCount = useMemo(() => {
    const checkedIn = activePlayers.filter((p) => p.checked_in_at != null).length;
    return checkedIn > 0 ? checkedIn : activePlayers.length;
  }, [activePlayers]);

  // Recommended N so everyone meets everyone once. ceil is the pre-filled default.
  const suggested = useMemo(
    () => suggestBatchTarget(eligibleCount, playersPerTeam),
    [eligibleCount, playersPerTeam],
  );
  const suggestRange =
    suggested.floor === suggested.ceil
      ? `${suggested.ceil}`
      : `${suggested.floor}–${suggested.ceil}`;

  const pendingCount = useMemo(
    () => matches.filter((m) => m.status === "pending").length,
    [matches],
  );

  const schema = useMemo(
    () =>
      z.object({
        minMatches: z
          .number()
          .int()
          .min(1, t("generateDialogMinError"))
          .max(20, t("generateDialogMinError")),
      }),
    [t],
  );

  const form = useForm({
    defaultValues: { minMatches: suggested.ceil },
    validators: { onSubmit: schema },
    onSubmit: async ({ value }) => {
      startTransition(async () => {
        const res = await generateClubQueueAction(clubId, { minMatches: value.minMatches });
        if ("error" in res) {
          toast.error(res.error);
        } else {
          toast.success(t("toastGenerated", { count: res.created }));
          setOpen(false);
          onRefresh();
        }
      });
    },
  });

  // Reset to the freshly-computed suggested target only when the dialog TRANSITIONS
  // open (false→true). Depending on suggested.ceil here would re-fire mid-session
  // whenever a check-in change recomputes it — silently wiping a manually-typed N.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open && !wasOpen.current) {
      form.reset({ minMatches: suggested.ceil });
      setConfirmingReroll(false);
    }
    wasOpen.current = open;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleReroll = () => {
    startTransition(async () => {
      const res = await regenerateClubQueueAction(clubId, {
        minMatches: form.state.values.minMatches,
      });
      if ("error" in res) {
        toast.error(res.error);
      } else {
        toast.success(t("toastRegenerated", { count: res.created }));
        setConfirmingReroll(false);
        setOpen(false);
        onRefresh();
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              size="sm"
              variant="default"
              className="h-8 text-xs gap-1"
              onClick={() => setOpen(true)}
            >
              <Shuffle className="h-3.5 w-3.5" />
              {t("generateQueueButton")}
            </Button>
          }
        />
        <TooltipContent>{t("generateQueueTooltip")}</TooltipContent>
      </Tooltip>

      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("generateDialogTitle")}</DialogTitle>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            form.handleSubmit();
          }}
          className="space-y-4"
        >
          <form.Field
            name="minMatches"
            children={(field) => {
              const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;
              return (
                <Field data-invalid={isInvalid}>
                  <FieldLabel htmlFor={field.name}>{t("generateDialogMinLabel")}</FieldLabel>
                  <div className="flex items-center gap-2">
                    <Input
                      id={field.name}
                      type="number"
                      min={1}
                      max={20}
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(e) => field.handleChange(Number(e.target.value))}
                      aria-invalid={isInvalid}
                      className="[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                    />
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            className="h-9 w-9 shrink-0"
                            aria-label={t("generateDialogResetAriaLabel")}
                            disabled={field.state.value === suggested.ceil}
                            onClick={() => field.handleChange(suggested.ceil)}
                          >
                            <RotateCcw className="h-3.5 w-3.5" />
                          </Button>
                        }
                      />
                      <TooltipContent>
                        {t("generateDialogResetTooltip", { value: suggested.ceil })}
                      </TooltipContent>
                    </Tooltip>
                  </div>
                  <p className="text-xs text-muted-foreground">{t("generateDialogMinHint")}</p>
                  {eligibleCount > 0 && (
                    <p className="text-xs text-muted-foreground">
                      {t("generateDialogSuggestHint", { range: suggestRange, count: eligibleCount })}
                    </p>
                  )}
                  {isInvalid && <FieldError errors={fieldErrors(field.state.meta.errors)} />}
                </Field>
              );
            }}
          />

          <form.Subscribe selector={(s) => s.values.minMatches}>
            {(minMatches) => {
              const rows = buildPreviewRows(activePlayers, matches, minMatches, clubStart, clubEnd);
              return (
                <div className="rounded-md border max-h-64 overflow-y-auto">
                  {rows.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-4">
                      {t("generatePreviewEmpty")}
                    </p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t("generatePreviewName")}</TableHead>
                          <TableHead className="text-right">{t("generatePreviewTarget")}</TableHead>
                          <TableHead className="text-right">{t("generatePreviewPlayed")}</TableHead>
                          <TableHead className="text-right">{t("generatePreviewShortfall")}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {rows.map((row) => (
                          <TableRow key={row.id}>
                            <TableCell className="max-w-[8rem] truncate">{row.name}</TableCell>
                            <TableCell className="text-right tabular-nums">{row.target}</TableCell>
                            <TableCell className="text-right tabular-nums">{row.have}</TableCell>
                            <TableCell
                              className={
                                row.shortfall > 0
                                  ? "text-right tabular-nums font-medium text-warning-foreground"
                                  : "text-right tabular-nums text-muted-foreground"
                              }
                            >
                              {row.shortfall}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </div>
              );
            }}
          </form.Subscribe>

          {confirmingReroll ? (
            <div className="space-y-3">
              <p className="text-sm text-warning-foreground">
                {t("regenerateConfirm", { count: pendingCount })}
              </p>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => setConfirmingReroll(false)}
                >
                  {t("generateDialogCancel")}
                </Button>
                <Button type="button" variant="destructive" disabled={busy} onClick={handleReroll}>
                  {busy ? t("regenerateSubmitting") : t("regenerateConfirmSubmit")}
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <DialogFooter className="gap-2 sm:justify-between">
              <div>
                {pendingCount > 0 && (
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          type="button"
                          variant="outline"
                          disabled={busy}
                          className="h-9 gap-1"
                          onClick={() => setConfirmingReroll(true)}
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                          {t("regenerateButton")}
                        </Button>
                      }
                    />
                    <TooltipContent>{t("regenerateTooltip")}</TooltipContent>
                  </Tooltip>
                )}
              </div>
              <div className="flex gap-2">
                <DialogClose
                  render={
                    <Button type="button" variant="outline" disabled={busy}>
                      {t("generateDialogCancel")}
                    </Button>
                  }
                />
                <Button type="submit" disabled={busy}>
                  {busy ? t("generateDialogSubmitting") : t("generateDialogSubmit")}
                </Button>
              </div>
            </DialogFooter>
          )}
        </form>
      </DialogContent>
    </Dialog>
  );
}
