"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getTranslations } from "next-intl/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/auth/session";
import {
  type ClubQueueSettings,
  ClubQueueSettingsSchema,
  parseQueueSettings,
} from "@/lib/club/queue-settings";
import { loginRedirect, assertClubOwner, assertCanManageClub } from "@/lib/club/permissions";
import { revalidateClubTree } from "@/lib/club/revalidate";
import {
  cleanupSeriesAfterSessionDelete,
  latestSessionOfSeries,
  repointPendingLinkRequestsBeforeDelete,
} from "@/lib/club/series.server";
import type { ClubSeries } from "@/lib/types";

// Max length of a single court name (shared by updateClubCourtsAction + renameClubCourtAction).
const COURT_NAME_MAX = 40;

function clubSchema(nameTooShortMsg: string, venueRequiredMsg: string) {
  return z.object({
    name: z.string().min(2, nameTooShortMsg),
    venue: z.string().min(2, venueRequiredMsg),
    play_date: z.string().min(1),
    start_time: z.string().min(1),
    end_time: z.string().min(1),
    max_players: z.coerce.number().int().min(2).max(40),
    shuttle_info: z.string().optional().nullable(),
    notes: z.string().optional().nullable(),
  });
}
// Static fallback for type inference only; call sites pass translated messages.
const ClubSchema = clubSchema("name_too_short", "venue_required");

export type CreateClubInput = z.infer<typeof ClubSchema>;
export type UpdateClubInput = CreateClubInput & { id: string };

export async function updateClubAction(input: UpdateClubInput) {
  const session = await getSession();
  if (!session) return await loginRedirect();

  const t = await getTranslations("actions");
  const { id, ...rest } = input;
  const parsed = clubSchema(t("club.clubNameTooShort"), t("club.clubVenueRequired")).safeParse(rest);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? t("club.invalidData") };
  }

  const sb = await createAdminClient();
  const { data: club } = await sb
    .from("clubs")
    .select("owner_id, max_players")
    .eq("id", id)
    .single();
  if (!club || club.owner_id !== session.profileId) return { error: t("club.noPermission") };

  const { error } = await sb.from("clubs").update(parsed.data).eq("id", id);
  if (error) return { error: error.message };

  // Only a RAISED cap opens slots → auto-promote earliest reserves to fill them.
  // Gating on an actual increase (vs running on every settings save) avoids two
  // wasted count queries per save, prevents surprise promotes on unrelated edits,
  // and narrows the unlocked promote race to the rare cap-raise path.
  if (parsed.data.max_players > club.max_players) {
    await promoteReservesToFill(sb, id, parsed.data.max_players);
  }

  revalidateClubTree();
  return { ok: true };
}

/**
 * OWNER-ONLY hard delete of a club. Co-admins cannot delete (uses the exact
 * owner_id check, NOT assertCanManageClub). All child rows (club_players,
 * club_matches, club_expenses, club_admins, club_locked_pairs) are removed by
 * FK ON DELETE CASCADE — verified live, so a single delete on the club row is
 * enough. Redirects to /clubs on success (redirect throws → called last).
 */
export async function deleteClubAction(clubId: string): Promise<{ error: string }> {
  const session = await getSession();
  if (!session) return await loginRedirect();

  const t = await getTranslations("actions");
  const sb = await createAdminClient();
  const { data: club } = await sb
    .from("clubs")
    .select("owner_id, series_id")
    .eq("id", clubId)
    .single();
  if (!club || club.owner_id !== session.profileId) return { error: t("club.noPermission") };

  // Capture the series (if any) BEFORE the delete — the post-delete cleanup
  // below (ADR 0002 decision #12 hidden-adhoc-series removal / decision #3
  // active-session repoint) needs its pre-delete state.
  const seriesId = club.series_id as string | null;
  let series: Pick<ClubSeries, "id" | "is_adhoc" | "active_session_id"> | null = null;
  if (seriesId) {
    const { data: seriesRow } = await sb
      .from("club_series")
      .select("id, is_adhoc, active_session_id")
      .eq("id", seriesId)
      .maybeSingle();
    series = seriesRow;
  }

  // "Latest remaining session" fallback, computed ONCE pre-delete and shared by
  // both series invariants (see `repointPendingLinkRequestsBeforeDelete` +
  // `cleanupSeriesAfterSessionDelete` in `src/lib/club/series.server.ts`): the
  // pre-delete latest-excluding-this-club IS the post-delete latest. Only
  // needed when the active pointer is missing or is the session being deleted —
  // otherwise the repoint targets the active session and the post-delete
  // pointer re-aim never fires.
  let fallbackId: string | null = null;
  if (series && (!series.active_session_id || series.active_session_id === clubId)) {
    fallbackId = await latestSessionOfSeries(sb, series.id, clubId);
  }

  if (series) {
    await repointPendingLinkRequestsBeforeDelete(sb, clubId, series, fallbackId);
  }

  const { error } = await sb.from("clubs").delete().eq("id", clubId);
  if (error) return { error: error.message };

  // Best-effort post-delete series cleanup (hidden ad-hoc GC + active-pointer
  // re-aim) — never blocks the delete itself, which already succeeded above.
  if (series) {
    await cleanupSeriesAfterSessionDelete(sb, clubId, series, fallbackId);
  }

  revalidateClubTree();
  redirect("/clubs");
}

/**
 * Owner-only: toggle a club between private (manager-only, default) and public
 * (read-only viewable by anyone at /c/[id], with cost/money hidden). Revalidates
 * both the manager page and the public route. No share_token — the public URL is
 * the stable club id, gated by this flag at the page level.
 */
export async function setClubVisibilityAction(
  clubId: string,
  isPublic: boolean,
): Promise<{ ok: true } | { error: string }> {
  const session = await getSession();
  if (!session) return await loginRedirect();

  const t = await getTranslations("actions");
  const sb = await createAdminClient();
  if (!(await assertClubOwner(sb, clubId, session.profileId))) return { error: t("club.noPermission") };

  const { error } = await sb.from("clubs").update({ is_public: isPublic }).eq("id", clubId);
  if (error) return { error: error.message };

  revalidateClubTree();
  revalidatePath(`/c/${clubId}`);
  return { ok: true };
}

/**
 * Promote earliest reserves (position asc, joined_at asc tiebreak) to active until
 * the active count reaches `maxPlayers`. No-op when already at/over cap or no reserves
 * wait. Called only on a max_players raise — mirrors the leave-time promote RPC.
 *
 * Not transactional/row-locked (unlike `remove_club_player_and_promote`): the
 * select-then-update window can race a concurrent join that adds a fresh active,
 * letting the headcount exceed the cap by the join count. The `.eq("status","reserve")`
 * re-check on the write keeps two concurrent raises from double-promoting the same
 * reserve. Acceptable for the rare cap-raise path; promote to an RPC if it ever races hot.
 */
async function promoteReservesToFill(
  sb: Awaited<ReturnType<typeof createAdminClient>>,
  clubId: string,
  maxPlayers: number,
): Promise<void> {
  const { active } = await countClubPlayers(sb, clubId);
  const slots = maxPlayers - active;
  if (slots <= 0) return;

  const { data: reserves } = await sb
    .from("club_players")
    .select("id")
    .eq("club_id", clubId)
    .eq("status", "reserve")
    .order("position", { ascending: true })
    .order("joined_at", { ascending: true })
    .limit(slots);
  if (!reserves || reserves.length === 0) return;

  await sb
    .from("club_players")
    .update({ status: "active" })
    // Re-assert under the write: don't resurrect a row a concurrent kick/leave-promote
    // already moved out of 'reserve' between the select above and this update.
    .eq("status", "reserve")
    .in(
      "id",
      reserves.map((r) => r.id),
    );
}

/**
 * Head-counts for a club: `total` (for the next sequential position) and
 * `active` (for the max_players cap — reserves don't count against it).
 */
async function countClubPlayers(
  sb: Awaited<ReturnType<typeof createAdminClient>>,
  clubId: string,
): Promise<{ total: number; active: number }> {
  const [{ count: total }, { count: active }] = await Promise.all([
    sb
      .from("club_players")
      .select("*", { count: "exact", head: true })
      .eq("club_id", clubId),
    sb
      .from("club_players")
      .select("*", { count: "exact", head: true })
      .eq("club_id", clubId)
      .eq("status", "active"),
  ]);
  return { total: total ?? 0, active: active ?? 0 };
}

/**
 * Owner / co-admin updates the club's rotation-queue settings.
 * Shallow-merges `patch` over the current settings, then re-validates the
 * merged object so bad patches are rejected before writing.
 */
export async function updateClubQueueSettingsAction(
  clubId: string,
  patch: Partial<ClubQueueSettings>,
): Promise<{ ok: true } | { error: string }> {
  const session = await getSession();
  if (!session) return await loginRedirect();

  const t = await getTranslations("actions");
  const sb = await createAdminClient();
  if (!(await assertCanManageClub(sb, clubId, session.profileId))) return { error: t("club.noPermission") };

  const { data: club, error: fetchError } = await sb
    .from("clubs")
    .select("queue_settings")
    .eq("id", clubId)
    .single();
  if (fetchError || !club) return { error: t("club.clubNotFound") };

  const current = parseQueueSettings(club.queue_settings);
  const merged = { ...current, ...patch };

  let validated: ClubQueueSettings;
  try {
    validated = ClubQueueSettingsSchema.parse(merged);
  } catch {
    return { error: t("club.invalidQueueSettings") };
  }

  const { error: writeError } = await sb
    .from("clubs")
    .update({ queue_settings: validated })
    .eq("id", clubId);
  if (writeError) return { error: writeError.message };

  revalidateClubTree();
  return { ok: true };
}

/**
 * Owner / co-admin sets the club's named courts (mirror tournament
 * updateCourtsAction). Trim + dedupe + cap; replaces queue_settings.court_count.
 */
export async function updateClubCourtsAction(
  clubId: string,
  courts: string[],
): Promise<{ ok: true; courts: string[] } | { error: string }> {
  const session = await getSession();
  if (!session) return await loginRedirect();

  const t = await getTranslations("actions");
  const sb = await createAdminClient();
  if (!(await assertCanManageClub(sb, clubId, session.profileId))) return { error: t("club.noPermission") };

  const COURTS_MAX = 50;
  const cleaned = courts
    .map((c) => c.trim().slice(0, COURT_NAME_MAX))
    .filter((c) => c.length > 0);
  const deduped = Array.from(new Set(cleaned)).slice(0, COURTS_MAX);

  const { error } = await sb.from("clubs").update({ courts: deduped }).eq("id", clubId);
  if (error) {
    console.error("[updateClubCourtsAction]", error);
    return { error: t("club.saveCourtsFailed") };
  }

  revalidateClubTree();
  return { ok: true, courts: deduped };
}

/**
 * Rename a single court in place. A whole-array update can't express a rename
 * (it can't tell "1"→"A" from delete-"1"+add-"A"), so this is a dedicated action
 * that (1) swaps the name at its existing position in `clubs.courts` and
 * (2) cascades the rename onto `club_matches.court` (stored by name) so existing
 * matches keep pointing at the same physical court instead of being orphaned.
 */
export async function renameClubCourtAction(
  clubId: string,
  oldName: string,
  newName: string,
): Promise<{ ok: true; courts: string[]; movedMatches: number } | { error: string }> {
  const session = await getSession();
  if (!session) return await loginRedirect();

  const t = await getTranslations("actions");
  const sb = await createAdminClient();
  if (!(await assertCanManageClub(sb, clubId, session.profileId))) return { error: t("club.noPermission") };

  const from = oldName.trim();
  const to = newName.trim().slice(0, COURT_NAME_MAX);
  if (!to) return { error: t("club.courtNameEmpty") };
  if (from === to) return { error: t("club.courtNameSame") };

  const { data: club, error: loadErr } = await sb
    .from("clubs")
    .select("courts")
    .eq("id", clubId)
    .maybeSingle();
  if (loadErr || !club) return { error: t("club.clubNotFound") };

  const courts = (club.courts ?? []) as string[];
  if (!courts.includes(from)) return { error: t("club.courtNotFound") };
  if (courts.includes(to)) return { error: t("club.courtNameDuplicate") };

  const next = courts.map((c) => (c === from ? to : c));
  const { error: updErr } = await sb.from("clubs").update({ courts: next }).eq("id", clubId);
  if (updErr) {
    console.error("[renameClubCourtAction]", updErr);
    return { error: t("club.renameCourtFailed") };
  }

  // Cascade onto matches that reference this court by name. `to` is guaranteed
  // not to collide with another court, so the in_progress occupancy unique index
  // (club_id, court) cannot conflict. Best-effort: the courts list is already
  // renamed; a cascade failure is logged but does not undo the rename.
  const { data: moved, error: matchErr } = await sb
    .from("club_matches")
    .update({ court: to })
    .eq("club_id", clubId)
    .eq("court", from)
    .select("id");
  if (matchErr) console.error("[renameClubCourtAction] match cascade", matchErr);

  revalidateClubTree();
  return { ok: true, courts: next, movedMatches: moved?.length ?? 0 };
}

/**
 * "ปิดรอบ" (grilled 2026-07-16) — DISPLAY-ONLY done flag on a session. Closing
 * hides it from /clubs (hero + "รอบตีของฉัน"); /clubs/mine and the series home
 * keep full history with a "จบแล้ว" badge. Editing stays open and
 * `active_session_id` is untouched (the pointer moves when the next round
 * opens). Reversible via reopenClubSessionAction. Rounds whose play_date has
 * passed are done automatically in display code — no cron writes this column.
 */
async function setSessionClosed(
  clubId: string,
  close: boolean,
): Promise<{ ok: true } | { error: string }> {
  const session = await getSession();
  if (!session) return await loginRedirect();

  const t = await getTranslations("actions");
  const sb = await createAdminClient();
  if (!(await assertCanManageClub(sb, clubId, session.profileId))) return { error: t("club.noPermission") };

  const { error } = await sb
    .from("clubs")
    .update({ closed_at: close ? new Date().toISOString() : null })
    .eq("id", clubId);
  if (error) return { error: error.message };

  await sb.from("club_audit_logs").insert({
    club_id: clubId,
    actor_id: session.profileId,
    actor_name: session.displayName,
    event_type: close ? "session_closed" : "session_reopened",
    detail: close ? "ปิดรอบ" : "ยกเลิกปิดรอบ",
  });

  revalidateClubTree();
  return { ok: true };
}

export async function closeClubSessionAction(
  clubId: string,
): Promise<{ ok: true } | { error: string }> {
  return setSessionClosed(clubId, true);
}

export async function reopenClubSessionAction(
  clubId: string,
): Promise<{ ok: true } | { error: string }> {
  return setSessionClosed(clubId, false);
}
