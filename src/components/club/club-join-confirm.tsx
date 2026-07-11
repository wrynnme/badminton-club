"use client";

/**
 * ClubJoinConfirm — the player-facing button on /clubs/join/[token]. Tapping it
 * calls requestClubLinkAction, which drops (or refreshes) the player's pending
 * link request in the club pool. Kept as a client action so no mutation runs
 * during the page's GET render.
 */

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { CheckCircle2, Link2, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { requestClubLinkAction } from "@/lib/actions/club-linking";

export function ClubJoinConfirm({ token, clubName }: { token: string; clubName: string }) {
  const t = useTranslations("club.linking");
  const [pending, start] = useTransition();
  // null = not submitted yet. Otherwise the action's resolved state: "already_linked"
  // (a manager linked this player in the race between page render and this tap) vs
  // "pending" (dropped into the pool). Showing the right one avoids telling a
  // just-linked player their request is still "awaiting approval".
  const [done, setDone] = useState<"pending" | "already_linked" | null>(null);

  if (done) {
    const linked = done === "already_linked";
    return (
      <div className="flex items-start gap-2 rounded-md border border-green-500/30 bg-green-500/5 p-3">
        <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-green-600" />
        <div className="space-y-0.5">
          <p className="text-sm font-medium">{t(linked ? "joinAlreadyTitle" : "joinPendingTitle")}</p>
          <p className="text-xs text-muted-foreground">
            {t(linked ? "joinAlreadyDesc" : "joinPendingDesc", { club: clubName })}
          </p>
        </div>
      </div>
    );
  }

  const submit = () =>
    start(async () => {
      const res = await requestClubLinkAction(token);
      if (res && "error" in res) {
        toast.error(res.error);
        return;
      }
      setDone(res && "state" in res && res.state === "already_linked" ? "already_linked" : "pending");
    });

  return (
    <Button onClick={submit} disabled={pending} className="w-full">
      {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
      {t("joinButton", { club: clubName })}
    </Button>
  );
}
