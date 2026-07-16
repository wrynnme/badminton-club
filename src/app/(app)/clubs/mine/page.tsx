import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/auth/session";
import { Button } from "@/components/ui/button";
import { getTranslations } from "next-intl/server";
import { MySessionGroups } from "@/components/club/my-session-groups";
import { buildMySessionGroups } from "@/lib/club/my-sessions";
import { fetchMySessionRows } from "@/lib/club/my-sessions.server";

export const dynamic = "force-dynamic";

/**
 * `/clubs/mine` — every รอบตี this user manages (owner / co-admin / series
 * co-admin) or plays in, grouped per ก๊วน via the shared builder (same list as
 * the /clubs bottom section, so the two surfaces can never drift). เฉพาะกิจ and
 * legacy no-series rows pool into one bucket at the end; participant-only rows
 * get the "เข้าร่วม" badge.
 */
export default async function MyClubsPage() {
  const sb = await createAdminClient();
  const session = await getSession();
  const canCreate = !!session && !session.isGuest;

  const rows = session && !session.isGuest ? await fetchMySessionRows(sb, session.profileId) : [];
  const groups = buildMySessionGroups(rows);

  const t = await getTranslations("club");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t("page.myListHeading")}</h1>
        {canCreate && (
          <Link href="/clubs/new">
            <Button>{t("page.createButton")}</Button>
          </Link>
        )}
      </div>

      {!groups.length ? (
        <p className="text-muted-foreground">
          {canCreate ? t("page.emptyWithCreate") : t("page.emptyNoCreate")}
        </p>
      ) : (
        <MySessionGroups groups={groups} />
      )}
    </div>
  );
}
