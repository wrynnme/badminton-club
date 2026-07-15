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
 * `rows` are fetched server-side (the page calls `fetchLineBindingInventory`
 * directly) — this component never fetches on mount, only refreshes via
 * `router.refresh()` after a mutation.
 */

import { useState, useTransition, type ReactElement } from "react";
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

// ─── Shared confirm dialog (per-row + bulk use the same scaffold) ──────────

function UnbindConfirmDialog({
  renderTrigger,
  tooltip,
  title,
  description,
  confirmLabel,
  onConfirm,
}: {
  /** Trigger button — receives the dialog opener; the shared Tooltip wraps it. */
  renderTrigger: (openDialog: () => void) => ReactElement;
  tooltip: string;
  title: string;
  description: string;
  confirmLabel: string;
  /** Runs inside a transition; resolve `true` to close the dialog (success). */
  onConfirm: () => Promise<boolean>;
}) {
  const t = useTranslations("admin.lineBindings");
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();

  function handleConfirm() {
    start(async () => {
      if (await onConfirm()) setOpen(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger render={renderTrigger(() => setOpen(true))} />
        <TooltipContent>{tooltip}</TooltipContent>
      </Tooltip>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2">
          <DialogClose render={<Button variant="outline" disabled={pending}>{t("unbindConfirmCancel")}</Button>} />
          <Button variant="destructive" onClick={handleConfirm} disabled={pending}>
            {pending && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />}
            {pending ? t("unbinding") : confirmLabel}
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

  async function unbindOne(row: AdminLineBindingRow): Promise<boolean> {
    const res = await adminUnbindLineGroupAction({ target: row.target });
    if ("error" in res) {
      toast.error(res.error);
      return false;
    }
    toast.success(t("unbindSuccess", { club: row.clubName }));
    router.refresh();
    return true;
  }

  async function unbindAll(): Promise<boolean> {
    const res = await adminUnbindAllLineGroupsAction();
    if ("error" in res) {
      toast.error(res.error);
      return false;
    }
    // Best-effort batch: surface a partial failure instead of a green toast
    // that silently hides it.
    if (res.failed > 0) {
      toast.error(t("unbindAllPartial", { count: res.count, failed: res.failed }));
    } else {
      toast.success(t("unbindAllSuccess", { count: res.count }));
    }
    router.refresh();
    return true;
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
          <UnbindConfirmDialog
            tooltip={t("unbindAllTooltip")}
            title={t("unbindAllConfirmTitle")}
            description={t("unbindAllConfirmDesc", { count: rows.length })}
            confirmLabel={t("unbindAllConfirmButton")}
            onConfirm={unbindAll}
            renderTrigger={(openDialog) => (
              <Button type="button" variant="destructive" size="sm" disabled={rows.length === 0} onClick={openDialog}>
                <Link2Off className="h-3.5 w-3.5 mr-1" />
                {t("unbindAllButton")}
              </Button>
            )}
          />
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
                      {row.target.kind === "legacy" && (
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
                    <UnbindConfirmDialog
                      tooltip={t("unbindTooltip")}
                      title={t("unbindConfirmTitle")}
                      description={t("unbindConfirmDesc", { club: row.clubName })}
                      confirmLabel={t("unbindConfirmButton")}
                      onConfirm={() => unbindOne(row)}
                      renderTrigger={(openDialog) => (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-destructive hover:text-destructive"
                          aria-label={t("unbindTooltip")}
                          onClick={openDialog}
                        >
                          <Link2Off className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    />
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
