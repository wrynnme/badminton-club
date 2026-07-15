"use client";

import { useTransition } from "react";
import { useRouter } from "@bprogress/next/app";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { setActiveSessionAction } from "@/lib/actions/club-series";

/**
 * Per-history-row "ตั้งเป็นนัดปัจจุบัน" action (ADR 0002 decision #3 —
 * `active_session_id` is manually switchable, single click, no confirm).
 * Rendered as a sibling of (not nested inside) the row's `<Link>` — a
 * `<button>` inside an `<a>` is invalid HTML and would fight the row's own
 * navigation.
 */
export function SeriesSetActiveButton({ seriesId, clubId }: { seriesId: string; clubId: string }) {
  const t = useTranslations("club.series");
  const router = useRouter();
  const [pending, start] = useTransition();

  function handleClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    start(async () => {
      const res = await setActiveSessionAction({ seriesId, clubId });
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success(t("setActiveSuccessToast"));
      router.refresh();
    });
  }

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button size="xs" variant="outline" className="gap-1 shrink-0" disabled={pending} onClick={handleClick}>
            {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Star className="h-3 w-3" />}
            {t("setActiveButton")}
          </Button>
        }
      />
      <TooltipContent>{t("setActiveTooltip")}</TooltipContent>
    </Tooltip>
  );
}
