import Link from "next/link";
import { format } from "date-fns";
import { getLocale, getTranslations } from "next-intl/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/auth/session";
import { dateFnsLocaleOf } from "@/i18n/date-fns-locale";
import { ArchivedSeriesSection, type ArchivedSeriesEntry } from "@/components/club/archived-series-section";

export const dynamic = "force-dynamic";

/**
 * `/clubs/archive` — owner's archived ก๊วน + "กู้คืน" (moved off `/clubs`
 * 2026-07-16 to declutter the main list). Owner-only rows (`owner_id` +
 * `archived_at IS NOT NULL`), same fetch/format the `/clubs` inline section used.
 */
export default async function ClubsArchivePage() {
  const sb = await createAdminClient();
  const session = await getSession();
  const locale = await getLocale();
  const t = await getTranslations("club");

  let archivedEntries: ArchivedSeriesEntry[] = [];
  if (session && !session.isGuest) {
    const { data } = await sb
      .from("club_series")
      .select("id, name, archived_at")
      .eq("owner_id", session.profileId)
      .not("archived_at", "is", null)
      .order("archived_at", { ascending: false });
    archivedEntries = ((data ?? []) as { id: string; name: string; archived_at: string }[]).map(
      (row): ArchivedSeriesEntry => ({
        seriesId: row.id,
        name: row.name,
        archivedDateLabel: format(new Date(row.archived_at), "d MMM yyyy", { locale: dateFnsLocaleOf(locale) }),
      }),
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">{t("series.archivedHeading")}</h1>
        <Link href="/clubs" className="text-sm text-muted-foreground hover:text-foreground">
          {t("page.backToClubs")}
        </Link>
      </div>

      {archivedEntries.length === 0 ? (
        <p className="text-muted-foreground">{t("series.archivedEmpty")}</p>
      ) : (
        <ArchivedSeriesSection entries={archivedEntries} defaultOpen />
      )}
    </div>
  );
}
