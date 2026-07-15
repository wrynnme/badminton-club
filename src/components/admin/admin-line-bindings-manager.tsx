"use client";

/**
 * AdminLineBindingsManager — site-admin card on `/admin` listing every ก๊วน
 * currently bound to a LINE group (locked design, spec.md § "📥 User requests"
 * item 3). Unbind one row or all of them; both go through a plain confirm
 * Dialog naming the impact (group billing/notifications break until rebound)
 * and the fact that the owner gets a LINE 1:1 notice. Mirrors the style of
 * `admin-levels-manager.tsx` (Card + table + dialogs + toasts + useTransition
 * + router.refresh).
 *
 * `rows` are fetched server-side (the page calls `listLineBindingsAction`
 * directly) — this component never fetches on mount, only refreshes via
 * `router.refresh()` after a mutation.
 */

import { useState, useTransition } from "react";
import { useRouter } from "@bprogress/next/app";
import { useTranslations, useLocale } from "next-intl";
import { toast } from "sonner";
import { format } from "date-fns";
import { Link2Off, Loader2 } from "lucide-react";
import { dateFnsLocaleOf } from "@/i18n/date-fns-locale";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { adminUnbindAllLineGroupsAction, adminUnbindLineGroupAction } from "@/lib/actions/admin-line-bindings";
import type { AdminLineBindingRow, AdminLineBindingTarget } from "@/lib/club/line-bindings.server";

function targetKey(target: AdminLineBindingTarget): string {
  return target.kind === "series" ? `series:${target.seriesId}` : `legacy:${target.clubId}`;
}

// ─── Per-row unbind ────────────────────────────────────────────────────────

function UnbindRowButton({ row, onDone }: { row: AdminLineBindingRow; onDone: () => void }) {
  const t = useTranslations("admin.lineBindings");
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();

  function handleConfirm() {
    start(async () => {
      const res = await adminUnbindLineGroupAction({ target: row.target });
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success(t("unbindSuccess", { club: row.clubName }));
      setOpen(false);
      onDone();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-destructive hover:text-destructive"
              aria-label={t("unbindTooltip")}
              onClick={() => setOpen(true)}
            >
              <Link2Off className="h-3.5 w-3.5" />
            </Button>
          }
        />
        <TooltipContent>{t("unbindTooltip")}</TooltipContent>
      </Tooltip>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("unbindConfirmTitle")}</DialogTitle>
          <DialogDescription>{t("unbindConfirmDesc", { club: row.clubName })}</DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2">
          <DialogClose render={<Button variant="outline" disabled={pending}>{t("unbindConfirmCancel")}</Button>} />
          <Button variant="destructive" onClick={handleConfirm} disabled={pending}>
            {pending && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />}
            {t("unbindConfirmButton")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Bulk unbind-all ───────────────────────────────────────────────────────

function UnbindAllButton({ count, onDone }: { count: number; onDone: () => void }) {
  const t = useTranslations("admin.lineBindings");
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();

  function handleConfirm() {
    start(async () => {
      const res = await adminUnbindAllLineGroupsAction();
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success(t("unbindAllSuccess", { count: res.count }));
      setOpen(false);
      onDone();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button type="button" variant="destructive" size="sm" disabled={count === 0} onClick={() => setOpen(true)}>
              <Link2Off className="h-3.5 w-3.5 mr-1" />
              {t("unbindAllButton")}
            </Button>
          }
        />
        <TooltipContent>{t("unbindAllTooltip")}</TooltipContent>
      </Tooltip>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("unbindAllConfirmTitle")}</DialogTitle>
          <DialogDescription>{t("unbindAllConfirmDesc", { count })}</DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2">
          <DialogClose render={<Button variant="outline" disabled={pending}>{t("unbindAllConfirmCancel")}</Button>} />
          <Button variant="destructive" onClick={handleConfirm} disabled={pending}>
            {pending && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />}
            {pending ? t("unbinding") : t("unbindAllConfirmButton")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main component ───────────────────────────────────────────────────────

export function AdminLineBindingsManager({ rows }: { rows: AdminLineBindingRow[] }) {
  const t = useTranslations("admin.lineBindings");
  const locale = useLocale();
  const router = useRouter();

  function refresh() {
    router.refresh();
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">{t("title")}</CardTitle>
        <p className="text-xs text-muted-foreground">{t("description")}</p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">{t("countLabel", { count: rows.length })}</span>
          <UnbindAllButton count={rows.length} onDone={refresh} />
        </div>

        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground py-1">{t("empty")}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("colClub")}</TableHead>
                <TableHead>{t("colOwner")}</TableHead>
                <TableHead>{t("colLastSession")}</TableHead>
                <TableHead className="text-right">{t("colActions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={targetKey(row.target)}>
                  <TableCell className="font-medium">
                    <span className="flex items-center gap-1.5 whitespace-normal">
                      {row.clubName}
                      {row.level === "legacy" && (
                        <Tooltip>
                          <TooltipTrigger render={<Badge variant="outline">{t("legacyBadge")}</Badge>} />
                          <TooltipContent>{t("legacyBadgeTooltip")}</TooltipContent>
                        </Tooltip>
                      )}
                    </span>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{row.ownerName}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {row.latestPlayDate
                      ? format(new Date(row.latestPlayDate), "d MMM yyyy", { locale: dateFnsLocaleOf(locale) })
                      : t("noSession")}
                  </TableCell>
                  <TableCell className="text-right">
                    <UnbindRowButton row={row} onDone={refresh} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
