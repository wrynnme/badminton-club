"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useForm } from "@tanstack/react-form";
import * as z from "zod";
import { toast } from "sonner";
import { Shuffle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
import { generateClubQueueAction } from "@/lib/actions/club-matches";
import { buildPreviewRows, type PreviewPlayer } from "@/lib/club/queue-preview";
import type { ClubMatch } from "@/lib/types";

export function GenerateQueueDialog({
  clubId,
  players,
  matches,
  clubStart,
  clubEnd,
  batchMinMatches,
  onRefresh,
}: {
  clubId: string;
  players: PreviewPlayer[];
  matches: ClubMatch[];
  clubStart: string;
  clubEnd: string;
  batchMinMatches: number;
  onRefresh: () => void;
}) {
  const t = useTranslations("club.queuePanel");
  const [open, setOpen] = useState(false);
  const [busy, startTransition] = useTransition();

  const activePlayers = useMemo(
    () => players.filter((p) => p.status === "active"),
    [players],
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
    defaultValues: { minMatches: batchMinMatches },
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

  // Reset to the latest remembered default whenever the dialog (re)opens.
  useEffect(() => {
    if (open) form.reset({ minMatches: batchMinMatches });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, batchMinMatches]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger
          render={
            <DialogTrigger
              render={
                <Button size="sm" variant="default" className="h-8 text-xs gap-1">
                  <Shuffle className="h-3.5 w-3.5" />
                  {t("generateQueueButton")}
                </Button>
              }
            />
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
                  <p className="text-xs text-muted-foreground">{t("generateDialogMinHint")}</p>
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

          <DialogFooter>
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
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
