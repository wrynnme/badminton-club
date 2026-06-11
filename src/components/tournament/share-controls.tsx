"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Link2, Link2Off, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { ShareLinkRow } from "@/components/share-link-row";
import { generateShareTokenAction, revokeShareTokenAction } from "@/lib/actions/tournaments";

export function ShareControls({
  tournamentId,
  shareToken,
  appUrl,
  isOwner = true,
}: {
  tournamentId: string;
  shareToken: string | null;
  appUrl: string;
  /**
   * When false, the component is read-only — co-admins see + copy + QR
   * but the generate/revoke buttons are hidden. Server actions still
   * enforce owner-only at the action layer.
   */
  isOwner?: boolean;
}) {
  const t = useTranslations("tournament");
  const [token, setToken] = useState(shareToken);
  const [isPending, start] = useTransition();

  const generate = () =>
    start(async () => {
      const res = await generateShareTokenAction(tournamentId);
      if ("error" in res) { toast.error(res.error); return; }
      setToken(res.token);
      toast.success(t("shareControls.toastGenerated"));
    });

  const revoke = () =>
    start(async () => {
      const res = await revokeShareTokenAction(tournamentId);
      if ("error" in res) { toast.error(res.error); return; }
      setToken(null);
      toast.success(t("shareControls.toastRevoked"));
    });

  return (
    <div className="flex flex-col gap-2">
      {token ? (
        <ShareLinkRow
          appUrl={appUrl}
          path={`/t/${token}`}
          qrTitle={t("shareControls.qrTitle")}
          trailing={
            isOwner && (
              <Button size="sm" variant="outline" className="h-8 shrink-0 text-destructive hover:text-destructive" aria-label={t("shareControls.ariaRevoke")} onClick={revoke} disabled={isPending}>
                <Link2Off className="h-3.5 w-3.5" />
              </Button>
            )
          }
        />
      ) : isOwner ? (
        <Button size="sm" variant="outline" onClick={generate} className="self-start" disabled={isPending}>
          {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />}
          {isPending ? t("shareControls.btnGenerating") : t("shareControls.btnGenerate")}
        </Button>
      ) : (
        <p className="text-xs text-muted-foreground">{t("shareControls.noTokenCoAdmin")}</p>
      )}
      {token && (
        <p className="text-xs text-muted-foreground">{t("shareControls.tokenHint")}</p>
      )}
    </div>
  );
}
