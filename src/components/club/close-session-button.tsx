"use client";

import { useTransition } from "react";
import { useRouter } from "@bprogress/next/app";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2, CheckCircle2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { closeClubSessionAction, reopenClubSessionAction } from "@/lib/actions/clubs";

/**
 * "ปิดรอบ" / "ยกเลิกปิดรอบ" header action (grilled 2026-07-16). Display-only
 * lifecycle flag — no confirm dialog because closing locks nothing and is
 * reversible. `doneByDate` = the round's play_date has already passed: the
 * calendar has closed it and neither closing nor reopening can change that, so
 * NO button renders (decision 5 — a past-date round has no override). This also
 * avoids a dead-end: a manually-closed future round that later turns past would
 * otherwise show a "ยกเลิกปิดรอบ" button whose click can't lift the done state.
 */
export function CloseSessionButton({
  clubId,
  closedAt,
  doneByDate,
}: {
  clubId: string;
  closedAt: string | null;
  doneByDate: boolean;
}) {
  const t = useTranslations("club.page");
  const router = useRouter();
  const [pending, start] = useTransition();

  if (doneByDate) return null;
  const closing = !closedAt;

  function handleClick() {
    start(async () => {
      const res = closing
        ? await closeClubSessionAction(clubId)
        : await reopenClubSessionAction(clubId);
      if (res && "error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success(closing ? t("closeSuccessToast") : t("reopenSuccessToast"));
      router.refresh();
    });
  }

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button size="xs" variant="outline" className="gap-1 shrink-0" disabled={pending} onClick={handleClick}>
            {pending ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : closing ? (
              <CheckCircle2 className="h-3 w-3" />
            ) : (
              <Undo2 className="h-3 w-3" />
            )}
            {closing ? t("closeButton") : t("reopenButton")}
          </Button>
        }
      />
      <TooltipContent>{closing ? t("closeTooltip") : t("reopenTooltip")}</TooltipContent>
    </Tooltip>
  );
}
