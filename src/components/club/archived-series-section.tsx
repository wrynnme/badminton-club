"use client";

/**
 * ArchivedSeriesSection — ADR 0002 decision #13 gap fix: `/clubs` filters
 * `archived_at IS NULL` with no way back to an archived series. Owner-only
 * (mirrors `unarchiveClubSeriesAction`'s `assertSeriesOwner` gate) — collapsed
 * by default so the common case (no archived series, or not looking for one)
 * stays visually quiet. `entries` are pre-fetched + pre-formatted server-side
 * by `/clubs/page.tsx` (mirrors how that page already formats `adhocEntries`
 * dates before render) so this component stays a plain presentational client
 * island — same Collapsible pattern as `club-locked-pairs.tsx`.
 */

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "@bprogress/next/app";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Archive, ArchiveRestore, ChevronDown, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { unarchiveClubSeriesAction } from "@/lib/actions/club-series";

export type ArchivedSeriesEntry = {
  seriesId: string;
  name: string;
  /** already formatted with the request locale — see `/clubs/page.tsx` */
  archivedDateLabel: string;
};

function RestoreButton({ seriesId }: { seriesId: string }) {
  const t = useTranslations("club.series");
  const router = useRouter();
  const [pending, start] = useTransition();

  function handleRestore() {
    start(async () => {
      const res = await unarchiveClubSeriesAction({ seriesId });
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success(t("archivedRestoreSuccess"));
      router.refresh();
    });
  }

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={handleRestore}
            disabled={pending}
          >
            {pending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
            ) : (
              <ArchiveRestore className="h-3.5 w-3.5 mr-1" />
            )}
            {t("archivedRestoreButton")}
          </Button>
        }
      />
      <TooltipContent>{t("archivedRestoreTooltip")}</TooltipContent>
    </Tooltip>
  );
}

export function ArchivedSeriesSection({
  entries,
  defaultOpen = false,
}: {
  entries: ArchivedSeriesEntry[];
  /** The dedicated /clubs/archive page opens it; the inline usages start collapsed. */
  defaultOpen?: boolean;
}) {
  const t = useTranslations("club.series");
  const [open, setOpen] = useState(defaultOpen);

  if (entries.length === 0) return null;

  return (
    <Card>
      <Collapsible open={open} onOpenChange={setOpen}>
        <CardHeader>
          <CollapsibleTrigger
            render={
              <button
                type="button"
                className="flex w-full items-center gap-1.5 text-left font-heading text-sm leading-snug font-medium"
              />
            }
          >
            <Archive className="h-4 w-4 shrink-0" />
            {t("archivedHeading")}
            <span className="text-xs font-normal text-muted-foreground">
              ({entries.length})
            </span>
            <ChevronDown
              className={`ml-auto h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 ${open ? "" : "-rotate-90"}`}
            />
          </CollapsibleTrigger>
        </CardHeader>

        <CollapsibleContent>
          <CardContent className="divide-y p-0">
            {entries.map((e) => (
              <div
                key={e.seriesId}
                className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm"
              >
                <Link
                  href={`/clubs/${e.seriesId}`}
                  className="font-medium line-clamp-1 hover:underline"
                >
                  {e.name}
                </Link>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="text-muted-foreground text-xs">{e.archivedDateLabel}</span>
                  <RestoreButton seriesId={e.seriesId} />
                </div>
              </div>
            ))}
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
