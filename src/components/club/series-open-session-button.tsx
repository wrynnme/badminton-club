"use client";

import { useState, useTransition } from "react";
import { useRouter } from "@bprogress/next/app";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { CalendarPlus, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { openClubSessionAction } from "@/lib/actions/club-series";
import { toDateStr } from "@/lib/utils";

/**
 * "จัดก๊วน" primary action (ADR 0002 decision #10 — button label is the verb
 * "จัดก๊วน", never used as the session-entity noun). Opens a date-picker
 * dialog, calls `openClubSessionAction`, and navigates straight into the new
 * session on success.
 */
export function SeriesOpenSessionButton({ seriesId, archived }: { seriesId: string; archived: boolean }) {
  const t = useTranslations("club.series");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [playDate, setPlayDate] = useState(() => toDateStr(new Date()));
  const [pending, start] = useTransition();

  function handleOpenDialog() {
    setPlayDate(toDateStr(new Date()));
    setOpen(true);
  }

  function handleSubmit() {
    if (!playDate) return;
    start(async () => {
      const res = await openClubSessionAction({ seriesId, playDate });
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success(t("openSuccessToast"));
      setOpen(false);
      router.push(`/clubs/${seriesId}/s/${res.clubId}`);
    });
  }

  return (
    <>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button disabled={archived} onClick={handleOpenDialog} className="gap-1.5">
              <CalendarPlus className="h-4 w-4" />
              {t("openSessionButton")}
            </Button>
          }
        />
        <TooltipContent>{archived ? t("openSessionArchivedTooltip") : t("openSessionTooltip")}</TooltipContent>
      </Tooltip>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("openDialogTitle")}</DialogTitle>
            <DialogDescription className="text-xs">{t("openDialogDesc")}</DialogDescription>
          </DialogHeader>

          <Field>
            <FieldLabel htmlFor="series-open-session-date">{t("openDialogDateLabel")}</FieldLabel>
            <Input
              id="series-open-session-date"
              type="date"
              value={playDate}
              onChange={(e) => setPlayDate(e.target.value)}
            />
          </Field>

          <DialogFooter className="gap-2">
            <DialogClose render={<Button variant="outline" disabled={pending}>{t("openDialogCancel")}</Button>} />
            <Button onClick={handleSubmit} disabled={pending || !playDate}>
              {pending ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                  {t("openDialogSubmitting")}
                </>
              ) : (
                t("openDialogSubmit")
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
