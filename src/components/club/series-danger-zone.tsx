"use client";

/**
 * SeriesDangerZone — owner-only rename / archive / delete controls for a
 * `club_series` row (ADR 0002 decision #13). Delete is blocked while any
 * session remains (FK RESTRICT on `clubs.series_id`) — archive is the
 * reversible alternative for a retired club.
 */

import { useState, useTransition } from "react";
import { useRouter } from "@bprogress/next/app";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { AlertTriangle, Archive, ArchiveRestore, Loader2, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  archiveClubSeriesAction,
  deleteClubSeriesAction,
  renameClubSeriesAction,
  unarchiveClubSeriesAction,
} from "@/lib/actions/club-series";

function RenameDialog({ seriesId, currentName }: { seriesId: string; currentName: string }) {
  const t = useTranslations("club.seriesDangerZone");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(currentName);
  const [pending, start] = useTransition();

  function handleSave() {
    const trimmed = name.trim();
    if (trimmed.length < 2) return;
    start(async () => {
      const res = await renameClubSeriesAction({ seriesId, name: trimmed });
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success(t("renameSuccess"));
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                setName(currentName);
                setOpen(true);
              }}
            >
              <Pencil className="h-3.5 w-3.5 mr-1" />
              {t("renameButton")}
            </Button>
          }
        />
        <TooltipContent>{t("renameTooltip")}</TooltipContent>
      </Tooltip>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("renameDialogTitle")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="series-rename-input">{t("renameLabel")}</Label>
            <Input
              id="series-rename-input"
              autoFocus
              value={name}
              maxLength={60}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSave();
              }}
            />
          </div>
          <DialogFooter className="gap-2">
            <DialogClose render={<Button variant="outline" disabled={pending}>{t("renameCancel")}</Button>} />
            <Button onClick={handleSave} disabled={pending || name.trim().length < 2}>
              {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {t("renameSave")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ArchiveToggleButton({ seriesId, archived }: { seriesId: string; archived: boolean }) {
  const t = useTranslations("club.seriesDangerZone");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();

  function handleUnarchive() {
    start(async () => {
      const res = await unarchiveClubSeriesAction({ seriesId });
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success(t("toastUnarchived"));
      router.refresh();
    });
  }

  function handleArchiveConfirm() {
    start(async () => {
      const res = await archiveClubSeriesAction({ seriesId });
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success(t("toastArchived"));
      setOpen(false);
      router.refresh();
    });
  }

  if (archived) {
    return (
      <Tooltip>
        <TooltipTrigger
          render={
            <Button type="button" size="sm" variant="outline" onClick={handleUnarchive} disabled={pending}>
              {pending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
              ) : (
                <ArchiveRestore className="h-3.5 w-3.5 mr-1" />
              )}
              {t("unarchiveButton")}
            </Button>
          }
        />
        <TooltipContent>{t("unarchiveTooltip")}</TooltipContent>
      </Tooltip>
    );
  }

  return (
    <>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>
              <Archive className="h-3.5 w-3.5 mr-1" />
              {t("archiveButton")}
            </Button>
          }
        />
        <TooltipContent>{t("archiveTooltip")}</TooltipContent>
      </Tooltip>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("archiveConfirmTitle")}</DialogTitle>
            <DialogDescription>{t("archiveConfirmDesc")}</DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <DialogClose render={<Button variant="outline" disabled={pending}>{t("archiveConfirmCancel")}</Button>} />
            <Button onClick={handleArchiveConfirm} disabled={pending}>
              {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {t("archiveConfirmButton")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function DeleteSeriesButton({
  seriesId,
  seriesName,
  hasSessions,
}: {
  seriesId: string;
  seriesName: string;
  hasSessions: boolean;
}) {
  const t = useTranslations("club.seriesDangerZone");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [pending, start] = useTransition();

  const confirmed = typed.trim() === seriesName.trim();

  function handleDelete() {
    if (!confirmed) return;
    start(async () => {
      const res = await deleteClubSeriesAction({ seriesId });
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      router.push("/clubs");
    });
  }

  const trigger = (
    <Button type="button" size="sm" variant="destructive" disabled={hasSessions} onClick={() => setOpen(true)}>
      <Trash2 className="h-3.5 w-3.5 mr-1" />
      {t("deleteButton")}
    </Button>
  );

  return (
    <>
      <Tooltip>
        <TooltipTrigger render={trigger} />
        <TooltipContent>{hasSessions ? t("deleteDisabledTooltip") : t("deleteTooltip")}</TooltipContent>
      </Tooltip>

      <Dialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) setTyped("");
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-destructive shrink-0" />
              {t("deleteDialogTitle", { name: seriesName })}
            </DialogTitle>
            <DialogDescription>{t("deleteDialogDesc")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="series-delete-confirm">{t("deleteConfirmLabel", { name: seriesName })}</Label>
            <Input
              id="series-delete-confirm"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={seriesName}
              autoComplete="off"
              disabled={pending}
            />
          </div>
          <DialogFooter className="gap-2">
            <DialogClose render={<Button variant="outline" disabled={pending}>{t("deleteCancel")}</Button>} />
            <Button variant="destructive" onClick={handleDelete} disabled={!confirmed || pending}>
              {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {pending ? t("deleting") : t("deleteConfirmButton")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function SeriesDangerZone({
  seriesId,
  seriesName,
  archived,
  hasSessions,
}: {
  seriesId: string;
  seriesName: string;
  archived: boolean;
  hasSessions: boolean;
}) {
  const t = useTranslations("club.seriesDangerZone");

  return (
    <Card className="border-destructive/30">
      <CardHeader>
        <CardTitle className="text-base text-destructive">{t("heading")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-2">
        <RenameDialog seriesId={seriesId} currentName={seriesName} />
        <ArchiveToggleButton seriesId={seriesId} archived={archived} />
        <DeleteSeriesButton seriesId={seriesId} seriesName={seriesName} hasSessions={hasSessions} />
      </CardContent>
    </Card>
  );
}
