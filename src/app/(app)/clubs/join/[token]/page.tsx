import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { CheckCircle2, LinkIcon, XCircle } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/auth/session";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ClubJoinConfirm } from "@/components/club/club-join-confirm";
import { findSeriesByJoinToken, getSeriesForClub, hasPendingSeriesRequest } from "@/lib/club/series.server";

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
    ? (await sb.from("clubs").select("id, name").eq("id", targetClubId).maybeSingle()).data
    : null;

  // Invalid / revoked token — nothing to join. `club` only resolves when either
  // `series` or `legacyClub` resolved, so this covers both.
  if (!club) {
    return (
      <JoinShell>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <XCircle className="h-5 w-5 text-destructive" />
            {t("joinInvalidTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{t("joinInvalidDesc")}</p>
        </CardContent>
      </JoinShell>
    );
  }

  // Not logged in → LINE login, returning here afterwards.
  const session = await getSession();
  if (!session) {
    redirect(`/api/auth/line?redirectTo=${encodeURIComponent(`/clubs/join/${token}`)}`);
  }

  // Already linked, or a pending request already sitting in the pool
  // (series-scoped — matches requestClubLinkAction's own idempotency check).
  // No series (rare/defensive) → fall back to the legacy club-scoped check.
  const [memberRes, hasPending] = await Promise.all([
    sb
      .from("club_players")
      .select("id")
      .eq("club_id", club.id)
      .eq("profile_id", session.profileId)
      .maybeSingle(),
    series
      ? hasPendingSeriesRequest(sb, series.id, session.profileId)
      : sb
          .from("club_link_requests")
          .select("id")
          .eq("club_id", club.id)
          .eq("profile_id", session.profileId)
          .eq("status", "pending")
          .limit(1)
          .then((r) => (r.data?.length ?? 0) > 0),
  ]);

  if (memberRes.data) {
    return (
      <JoinShell>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <CheckCircle2 className="h-5 w-5 text-green-600" />
            {t("joinAlreadyTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            {t("joinAlreadyDesc", { club: club.name })}
          </p>
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
        <CardContent>
          <p className="text-sm text-muted-foreground">
            {t("joinPendingDesc", { club: club.name })}
          </p>
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
          {t("joinTitle", { club: club.name })}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">{t("joinDesc", { club: club.name })}</p>
        <ClubJoinConfirm token={token} clubName={club.name} />
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
