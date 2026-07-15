import { notFound, redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { ClubSessionView } from "./session-view";

/**
 * /clubs/[id]/s/[sid] — canonical session (นัด) URL under its series (ก๊วนถาวร),
 * ADR 0002 decision #1. `[id]` is the series id (`club_series.id`), `[sid]` is
 * the session id (`clubs.id`).
 *
 * This wrapper does ONE cheap existence/ownership check before handing off to
 * `ClubSessionView` (which owns the full fetch — not deduped in this slice, see
 * ADR 0002 P2-B task notes): not-found → `notFound()`; a session that belongs to
 * a DIFFERENT series (or none, for a not-yet-migrated legacy row) → redirect to
 * its canonical URL so a stale/typo'd `[id]` never silently renders someone
 * else's series shell around the wrong session.
 */
export const dynamic = "force-dynamic";

export default async function ClubSessionPage({
  params,
}: {
  params: Promise<{ id: string; sid: string }>;
}) {
  const { id, sid } = await params;
  const sb = await createAdminClient();
  const { data: club } = await sb.from("clubs").select("id, series_id").eq("id", sid).maybeSingle();

  if (!club) notFound();
  if (club.series_id !== id) {
    redirect(club.series_id ? `/clubs/${club.series_id}/s/${club.id}` : `/clubs/${club.id}`);
  }

  return <ClubSessionView clubId={sid} />;
}
