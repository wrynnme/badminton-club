"use client";

/**
 * ClubJoinConfirm — the player-facing button on /clubs/join/[token]. Tapping it
 * calls requestClubLinkAction, which either (decision #4 — ADR 0002 P1) auto-links
 * a returning confirmed member immediately, or drops (/ refreshes) the player's
 * pending link request in the club pool. Kept as a client action so no mutation
 * runs during the page's GET render.
 */

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { CheckCircle2, Link2, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { requestClubLinkAction } from "@/lib/actions/club-linking";

type DoneState = "pending" | "already_linked" | "linked";

export function ClubJoinConfirm({ token, clubName }: { token: string; clubName: string }) {
  const t = useTranslations("club.linking");
  const [pending, start] = useTransition();
  // null = not submitted yet. Otherwise the action's resolved state:
  //   "already_linked" — a manager linked this player in the race between page
  //     render and this tap.
  //   "linked" — decision #4 auto-link just fired (returning confirmed member,
  //     clean roster-name match — no manager needed).
  //   "pending" — dropped into the pool, awaiting a manager.
  const [done, setDone] = useState<DoneState | null>(null);
  const [playerName, setPlayerName] = useState<string | null>(null);

  if (done) {
    const titleKey =
      done === "linked" ? "joinLinkedTitle" : done === "already_linked" ? "joinAlreadyTitle" : "joinPendingTitle";
    const descKey =
      done === "linked" ? "joinLinkedDesc" : done === "already_linked" ? "joinAlreadyDesc" : "joinPendingDesc";
    return (
      <div className="flex items-start gap-2 rounded-md border border-green-500/30 bg-green-500/5 p-3">
        <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-green-600" />
        <div className="space-y-0.5">
          <p className="text-sm font-medium">{t(titleKey)}</p>
          <p className="text-xs text-muted-foreground">
            {t(descKey, { club: clubName, player: playerName ?? "" })}
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
      const state = res && "state" in res ? res.state : "pending";
      if (state === "linked" && "playerName" in res) setPlayerName(res.playerName);
      setDone(state);
    });

  return (
    <Button onClick={submit} disabled={pending} className="w-full">
      {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
      {t("joinButton", { club: clubName })}
    </Button>
  );
}
