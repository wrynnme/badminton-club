import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { CheckCircle2, LinkIcon, XCircle } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/auth/session";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ClubJoinConfirm } from "@/components/club/club-join-confirm";

/**
 * /clubs/join/[token] — public LINE-linking entry point (see docs/adr/0001).
 *
 * A player opens the manager's join link, logs in with LINE (redirected here
 * after), and lands in the club's link pool. This page only READS state; the
 * pending-request insert happens through the ClubJoinConfirm client action so no
 * mutation runs during a GET render.
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
  const { data: club } = await sb
    .from("clubs")
    .select("id, name")
    .eq("join_token", token)
    .maybeSingle();

  // Invalid / revoked token — nothing to join.
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

  // Already linked, or a pending request already sitting in the pool.
  const [memberRes, reqRes] = await Promise.all([
    sb
      .from("club_players")
      .select("id")
      .eq("club_id", club.id)
      .eq("profile_id", session.profileId)
      .maybeSingle(),
    sb
      .from("club_link_requests")
      .select("status")
      .eq("club_id", club.id)
      .eq("profile_id", session.profileId)
      .maybeSingle(),
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

  if (reqRes.data?.status === "pending") {
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
