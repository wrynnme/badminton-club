import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { CheckCircle2, LinkIcon, XCircle } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/auth/session";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ClubJoinConfirm } from "@/components/club/club-join-confirm";
import { findSeriesByJoinToken, getSeriesForClub, hasPendingSeriesRequest } from "@/lib/club/series.server";
import { isSessionDone, todayBangkok } from "@/lib/club/session-done";

/**
 * /clubs/join/[token] — public LINE-linking entry point (see docs/adr/0001,
 * amended by ADR 0002 P1 — "club series").
 *
 * A player opens the manager's join link, logs in with LINE (redirected here
 * after), and lands in the club's link pool (or auto-links immediately if
 * they're a returning confirmed member — decision #4, see requestClubLinkAction).
 * This page only READS state — a GET render must never mutate. A not-yet-
 * migrated legacy club (rare/defensive; every existing prod club already has a
 * series post-backfill) resolves its series via the read-only `getSeriesForClub`
 * and TOLERATES a null series, falling back to club-scoped behavior (skips the
 * series-pending check below) rather than lazily attaching one — that lazy
 * migration (`ensureSeriesForClub`) only runs in the POST action
 * (`requestClubLinkAction`).
 *
 * Token resolution (decision #15): series-level `join_token` first, else a
 * legacy per-session `clubs.join_token` → that club's series.
 */
export const dynamic = "force-dynamic";

export default async function ClubJoinPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const t = await getTranslations("club.linking");

  const sb = await createAdminClient();

  let series = await findSeriesByJoinToken(sb, token);
  let legacyClub: { id: string; name: string } | null = null;
  if (!series) {
    const { data } = await sb.from("clubs").select("id, name").eq("join_token", token).maybeSingle();
    if (data) {
      legacyClub = data;
      series = await getSeriesForClub(sb, data.id);
    }
  }

  // Target = the series' active session (decision #3); fall back to the
  // legacy-matched club when the series has no active pointer yet (or no series).
  const targetClubId = series?.active_session_id ?? legacyClub?.id ?? null;
  const club = targetClubId
    ? (await sb.from("clubs").select("id, name, play_date, closed_at").eq("id", targetClubId).maybeSingle()).data
    : null;

  // Invalid / revoked token — nothing to join. A valid series with NO session is
  // fine (series-first, 2026-07-16): the link lands in the member registry and
  // the roster catches up when a รอบตี opens.
  if (!club && !series) {
    return (
      <JoinShell>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <XCircle className="h-5 w-5 text-destructive" />
            {t("joinInvalidTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">{t("joinInvalidDesc")}</p>
          {/* Even a dead link deserves a way onward (ship-check 2026-07-21). */}
          <Link href="/clubs" className="block w-full">
            <Button variant="outline" className="w-full">{t("joinCtaClubs")}</Button>
          </Link>
        </CardContent>
      </JoinShell>
    );
  }

  // Not logged in → LINE login, returning here afterwards.
  const session = await getSession();
  if (!session) {
    redirect(`/api/auth/line?redirectTo=${encodeURIComponent(`/clubs/join/${token}`)}`);
  }

  // Display name for every state below — the active session's name, else the
  // series name (sessionless).
  const displayName = club?.name ?? series!.name;

  // Already linked (roster row in the active session, or — sessionless — an
  // already-linked registry member), or a pending request already sitting in
  // the pool (series-scoped — matches requestClubLinkAction's own idempotency
  // check). No series (rare/defensive) → legacy club-scoped pending check.
  const [linkedRes, hasPending] = await Promise.all([
    club
      ? sb
          .from("club_players")
          .select("id")
          .eq("club_id", club.id)
          .eq("profile_id", session.profileId)
          .maybeSingle()
      : sb
          .from("series_members")
          .select("id")
          .eq("series_id", series!.id)
          .eq("profile_id", session.profileId)
          .maybeSingle(),
    series
      ? hasPendingSeriesRequest(sb, series.id, session.profileId)
      : sb
          .from("club_link_requests")
          .select("id")
          .eq("club_id", club!.id)
          .eq("profile_id", session.profileId)
          .eq("status", "pending")
          .limit(1)
          .then((r) => (r.data?.length ?? 0) > 0),
  ]);

  // Onward path for every terminal state (flow Step 1, 2026-07-21): the success
  // screen is the first page a new player ever sees — it must not dead-end.
  // Linked-with-session → straight into the รอบตี; anything else → /clubs.
  // A DONE round (closed / past play_date) doesn't get the "today's round" CTA —
  // the label would lie and there's nothing live to see.
  const clubIsLive = club !== null && !isSessionDone(club, todayBangkok());
  const sessionHref =
    club && clubIsLive ? (series ? `/clubs/${series.id}/s/${club.id}` : `/clubs/${club.id}`) : null;

  if (linkedRes.data) {
    return (
      <JoinShell>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <CheckCircle2 className="h-5 w-5 text-green-600" />
            {t(club ? "joinAlreadyTitle" : "joinMemberTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {t(club ? "joinAlreadyDesc" : "joinMemberDesc", { club: displayName })}
          </p>
          <JoinNextSteps sessionHref={sessionHref} hint={sessionHref ? null : t("joinExpectHint")} />
        </CardContent>
      </JoinShell>
    );
  }

  if (hasPending) {
    return (
      <JoinShell>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <CheckCircle2 className="h-5 w-5 text-green-600" />
            {t("joinPendingTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {t("joinPendingDesc", { club: displayName })}
          </p>
          <JoinNextSteps sessionHref={null} hint={t("joinExpectHint")} />
        </CardContent>
      </JoinShell>
    );
  }

  // New opt-in — offer the join button (the action inserts the pending request).
  return (
    <JoinShell>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <LinkIcon className="h-5 w-5" />
          {t("joinTitle", { club: displayName })}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">{t("joinDesc", { club: displayName })}</p>
        {!club && (
          <p className="text-xs text-muted-foreground">{t("joinNoSessionHint", { series: displayName })}</p>
        )}
        <ClubJoinConfirm token={token} clubName={displayName} sessionHref={sessionHref} />
      </CardContent>
    </JoinShell>
  );
}

function JoinShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-md px-4 py-10">
      <Card>{children}</Card>
    </div>
  );
}

/** Terminal-state CTAs: into the current รอบตี when one exists, always a way to /clubs. */
async function JoinNextSteps({ sessionHref, hint }: { sessionHref: string | null; hint: string | null }) {
  const t = await getTranslations("club.linking");
  return (
    <div className="flex flex-col gap-2">
      {sessionHref && (
        <Link href={sessionHref} className="w-full">
          <Button className="w-full">{t("joinCtaSession")}</Button>
        </Link>
      )}
      <Link href="/clubs" className="w-full">
        <Button variant={sessionHref ? "outline" : "default"} className="w-full">
          {t("joinCtaClubs")}
        </Button>
      </Link>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
