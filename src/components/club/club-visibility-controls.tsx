"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2, Globe } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ShareLinkRow } from "@/components/share-link-row";
import { setClubVisibilityAction } from "@/lib/actions/clubs";

/**
 * Owner-only club visibility toggle (settings tab). Off = private (manager-only);
 * on = public read-only at /c/[id] with money hidden. When public, surfaces the
 * stable link + copy + QR. Mirrors tournament ShareControls but a flat flag
 * (no generate/revoke token). Server action enforces owner-only regardless.
 */
export function ClubVisibilityControls({
  clubId,
  isPublic: initial,
  appUrl,
}: {
  clubId: string;
  isPublic: boolean;
  appUrl: string;
}) {
  const t = useTranslations("club.visibility");
  const [isPublic, setIsPublic] = useState(initial);
  const [isPending, start] = useTransition();

  const toggle = (next: boolean) =>
    start(async () => {
      const res = await setClubVisibilityAction(clubId, next);
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      setIsPublic(next);
      toast.success(next ? t("toastPublic") : t("toastPrivate"));
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Globe className="h-4 w-4" />
          {t("title")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <label className="flex items-start gap-2.5 cursor-pointer">
          <Checkbox
            checked={isPublic}
            onCheckedChange={(v) => toggle(v === true)}
            disabled={isPending}
            className="mt-0.5"
            aria-label={t("checkboxAriaLabel")}
          />
          <span className="space-y-0.5">
            <span className="block text-sm font-medium">{t("checkboxLabel")}</span>
            <span className="block text-xs text-muted-foreground">
              {t("checkboxDescription")}
            </span>
          </span>
          {isPending && <Loader2 className="mt-0.5 h-3.5 w-3.5 animate-spin text-muted-foreground" />}
        </label>

        {isPublic && (
          <ShareLinkRow appUrl={appUrl} path={`/c/${clubId}`} qrTitle={t("qrTitle")} />
        )}
      </CardContent>
    </Card>
  );
}
