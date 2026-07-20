"use client";

/**
 * ClubJoinConfirm — the player-facing button on /clubs/join/[token]. Tapping it
 * calls requestClubLinkAction, which either (decision #4 — ADR 0002 P1) auto-links
 * a returning confirmed member immediately, or drops (/ refreshes) the player's
 * pending link request in the club pool. Kept as a client action so no mutation
 * runs during the page's GET render.
 */

import { useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { CheckCircle2, Link2, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { requestClubLinkAction } from "@/lib/actions/club-linking";

type DoneState = "pending" | "already_linked" | "linked" | "member";

export function ClubJoinConfirm({
  token,
  clubName,
  sessionHref,
}: {
  token: string;
  clubName: string;
  /** Current รอบตี to jump into once linked (null = sessionless series). */
  sessionHref: string | null;
}) {
  const t = useTranslations("club.linking");
  const [pending, start] = useTransition();
  // null = not submitted yet. Otherwise the action's resolved state:
  //   "already_linked" — a manager linked this player in the race between page
  //     render and this tap.
  //   "linked" — decision #4 auto-link just fired (returning confirmed member,
  //     clean roster-name match — no manager needed).
  //   "member" — sessionless series (series-first, 2026-07-16): the registry
  //     link is confirmed; the next รอบตี picks them up.
  //   "pending" — dropped into the pool, awaiting a manager.
  const [done, setDone] = useState<DoneState | null>(null);
  const [playerName, setPlayerName] = useState<string | null>(null);

  if (done) {
    const KEYS: Record<DoneState, { title: string; desc: string }> = {
      linked: { title: "joinLinkedTitle", desc: "joinLinkedDesc" },
      already_linked: { title: "joinAlreadyTitle", desc: "joinAlreadyDesc" },
      member: { title: "joinMemberTitle", desc: "joinMemberDesc" },
      pending: { title: "joinPendingTitle", desc: "joinPendingDesc" },
    };
    const { title: titleKey, desc: descKey } = KEYS[done];
    // Onward CTAs (flow Step 1, 2026-07-21): linked states with a live รอบตี jump
    // straight in; member/pending point at /clubs with the expectation hint.
    const showSession = sessionHref !== null && (done === "linked" || done === "already_linked");
    return (
      <div className="space-y-3">
        <div className="flex items-start gap-2 rounded-md border border-green-500/30 bg-green-500/5 p-3">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-green-600" />
          <div className="space-y-0.5">
            <p className="text-sm font-medium">{t(titleKey)}</p>
            <p className="text-xs text-muted-foreground">
              {t(descKey, { club: clubName, player: playerName ?? "" })}
            </p>
          </div>
        </div>
        <div className="flex flex-col gap-2">
          {showSession && (
            <Link href={sessionHref} className="w-full">
              <Button className="w-full">{t("joinCtaSession")}</Button>
            </Link>
          )}
          <Link href="/clubs" className="w-full">
            <Button variant={showSession ? "outline" : "default"} className="w-full">
              {t("joinCtaClubs")}
            </Button>
          </Link>
          {!showSession && <p className="text-xs text-muted-foreground">{t("joinExpectHint")}</p>}
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
