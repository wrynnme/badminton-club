import { notFound, redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { ClubSessionView } from "./s/[sid]/session-view";
import { SeriesHome } from "./series-home";

/**
 * /clubs/[id] — dispatcher (ADR 0002 decision #1). `[id]` can resolve to EITHER
 * a `club_series.id` (the new canonical series-home URL) OR a legacy
 * `clubs.id` (a pre-restructure session link — UUIDs can't collide across the
 * two tables, so a lookup dispatch is safe):
 *
 *   1. `club_series` match:
 *      - `is_adhoc` → redirect straight to its session (decision #12 — ad-hoc
 *        series stay invisible; `active_session_id`, else the latest session).
 *      - else → render the series home shell.
 *   2. `clubs` match (legacy session URL):
 *      - `series_id` set → redirect to the canonical `/clubs/[seriesId]/s/[id]`.
 *      - `series_id` null (not yet migrated) → render the session view INLINE
 *        at this legacy URL. GET stays pure — no `ensureSeriesForClub` here.
 *   3. Neither → `notFound()`.
 */
export const dynamic = "force-dynamic";

export default async function ClubDispatchPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const sb = await createAdminClient();

  const { data: series } = await sb
    .from("club_series")
    .select("id, is_adhoc, active_session_id")
    .eq("id", id)
    .maybeSingle();

  if (series) {
    if (!series.is_adhoc) {
      return <SeriesHome seriesId={series.id} />;
    }

    let targetId = series.active_session_id as string | null;
    if (!targetId) {
      const { data: latest } = await sb
        .from("clubs")
        .select("id")
        .eq("series_id", series.id)
        .order("play_date", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      targetId = latest?.id ?? null;
    }
    if (targetId) {
      redirect(`/clubs/${series.id}/s/${targetId}`);
    }
    // Zero sessions under this ad-hoc series (should not normally happen —
    // decision #12 deletes the hidden series along with its last session).
    // Render the shell rather than crash.
    return <SeriesHome seriesId={series.id} />;
  }

  const { data: club } = await sb.from("clubs").select("id, series_id").eq("id", id).maybeSingle();
  if (club) {
    if (club.series_id) {
      redirect(`/clubs/${club.series_id}/s/${club.id}`);
    }
    return <ClubSessionView clubId={club.id} />;
  }

  notFound();
}
