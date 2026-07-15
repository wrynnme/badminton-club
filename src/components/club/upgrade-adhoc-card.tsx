"use client";

/**
 * UpgradeAdhocCard — shown in a session's settings tab when its series is
 * hidden ad-hoc (`club_series.is_adhoc = true`, ADR 0002 decision #12). Naming
 * it flips `is_adhoc` to false; nothing else moves — the same series/session
 * row keeps every LINE binding, member, and pair it already has.
 */

import { useState, useTransition } from "react";
import { useRouter } from "@bprogress/next/app";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2, Sparkles } from "lucide-react";
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
import { upgradeAdhocSeriesAction } from "@/lib/actions/club-series";

export function UpgradeAdhocCard({ seriesId }: { seriesId: string }) {
  const t = useTranslations("club.upgradeAdhoc");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [pending, start] = useTransition();

  function handleSubmit() {
    const trimmed = name.trim();
    if (trimmed.length < 2) return;
    start(async () => {
      const res = await upgradeAdhocSeriesAction({ seriesId, name: trimmed });
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success(t("toastSuccess"));
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Sparkles className="h-4 w-4" />
          {t("cardTitle")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">{t("cardDesc")}</p>
        <Button type="button" size="sm" onClick={() => setOpen(true)}>
          {t("upgradeButton")}
        </Button>
      </CardContent>

      <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setName(""); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("dialogTitle")}</DialogTitle>
            <DialogDescription className="text-xs">{t("dialogDesc")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="upgrade-adhoc-name">{t("nameLabel")}</Label>
            <Input
              id="upgrade-adhoc-name"
              autoFocus
              value={name}
              maxLength={60}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("namePlaceholder")}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSubmit();
              }}
            />
          </div>
          <DialogFooter className="gap-2">
            <DialogClose render={<Button variant="outline" disabled={pending}>{t("cancel")}</Button>} />
            <Button onClick={handleSubmit} disabled={pending || name.trim().length < 2}>
              {pending ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                  {t("upgrading")}
                </>
              ) : (
                t("confirm")
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
