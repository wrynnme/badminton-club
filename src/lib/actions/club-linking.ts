"use server";

/**
 * club-linking.ts — LINE linking for club rosters (see docs/adr/0001, amended by
 * ADR 0002 P1 — "club series", `docs/adr/0002-club-series-persistent-entity.md`).
 *
 * Attaches a real LINE account (a `profiles` row) to an existing GUEST
 * `club_players` row (`profile_id IS NULL`) so outbound pushes (bills,
 * notifications) reach a player who was previously unreachable (skippedNoLine).
 *
 * Mechanism = manager-confirmed pool (NOT auto-claim) — PLUS decision #4's
 * "returning member" exception:
 *   1. A manager generates a per-SERIES `join_token` and shares the join link
 *      (once, forever — stable across sessions; see `ensureSeriesForClub`).
 *   2. A player opens /clubs/join/[token], logs in with LINE, and
 *      `requestClubLinkAction` either (a) auto-links immediately if they're
 *      already a confirmed `series_members` row with a clean roster-name match
 *      (decision #4 — amends ADR 0001's "always manager-confirmed"), or
 *      (b)/(c) drops a `pending` row into `club_link_requests` (series-scoped).
 *   3. A manager links a pending request to a guest row (`linkClubPlayerAction`)
 *      or dismisses it (`dismissClubLinkRequestAction`).
 *
 * Every successful link (manager-confirmed or auto) writes through to the
 * series member registry (`upsertSeriesMember`) and stamps the roster row's
 * `member_id`, so the NEXT session inherits the link without re-confirming.
 *
 * All reads/writes use the service-role client; `club_link_requests` is
 * service-role-only (RLS on, no policy) and `profiles.line_user_id` never
 * reaches the client.
 */

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getTranslations } from "next-intl/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getSession, type SessionPayload } from "@/lib/auth/session";
import { loginRedirect, assertCanManageClub } from "@/lib/club/permissions";
import { pushTextToUser } from "@/lib/notification/line-club";
import { classifyRosterMatch, type RosterCandidate } from "@/lib/club/line-self-link";
import {
  clearSeriesBinding,
  ensureSeriesForClub,
  hasPendingSeriesRequest,
  resolveSeriesEntryByToken,
  upsertSeriesMember,
} from "@/lib/club/series.server";
import type { LinkableKnownProfile } from "@/lib/types";

type AdminClient = Awaited<ReturnType<typeof createAdminClient>>;

async function writeClubAudit(
  sb: AdminClient,
  clubId: string,
  session: SessionPayload,
  eventType: string,
  detail: string,
) {
  await sb.from("club_audit_logs").insert({
    club_id: clubId,
    actor_id: session.profileId,
    actor_name: session.displayName,
    event_type: eventType,
    detail,
  });
}

/**
 * Fire-and-forget "you're now linked" push to a freshly-linked player. The club-name
 * fetch is awaited; the push itself is not (never blocks or fails the link). No-op when
 * the profile has no LINE id. Shared by linkClubPlayerAction + linkKnownProfileAction.
 */
async function pushLinkConfirm(sb: AdminClient, clubId: string, lineUserId: string | null) {
  if (!lineUserId) return;
  const { data: club } = await sb.from("clubs").select("name").eq("id", clubId).maybeSingle();
  const clubName = club?.name ?? "";
  void pushTextToUser(
    lineUserId,
    `✅ เชื่อมบัญชี LINE กับก๊วน "${clubName}" เรียบร้อยแล้ว — จากนี้จะได้รับบิลและการแจ้งเตือนทาง LINE`,
  );
}

/**
 * Shared "member write-through" hunk duplicated in linkClubPlayerAction /
 * linkKnownProfileAction: resolve/create the club's series and write through to
 * the member registry BEFORE attaching, so member_id can be stamped in the SAME
 * club_players write as profile_id (decision #4/#11 — every successful link
 * updates series_members). Attach guards: `.is("profile_id", null)` stops two
 * profiles claiming the SAME row, and the partial UNIQUE index
 * uniq_club_players_profile on club_players (club_id, profile_id) WHERE
 * profile_id IS NOT NULL (migration 20260711000300) stops ONE profile being
 * linked to TWO rows at once. Returns the raw update result so each caller keeps
 * its own error handling/logging/comments (23505 vs 0-rows-matched differ per
 * caller's context).
 */
async function writeThroughMemberLink(
  sb: AdminClient,
  args: {
    clubId: string;
    targetPlayerId: string;
    profileId: string;
    targetDisplayName: string;
    targetLevelId: string | null;
    useLineName: boolean;
    lineDisplayName: string | null;
  },
) {
  const { clubId, targetPlayerId, profileId, targetDisplayName, targetLevelId, useLineName, lineDisplayName } = args;
  const finalName = useLineName && lineDisplayName ? lineDisplayName : targetDisplayName;
  const series = await ensureSeriesForClub(sb, clubId);
  const memberId = await upsertSeriesMember(sb, {
    seriesId: series.id,
    profileId,
    name: finalName,
    levelId: targetLevelId,
  });

  const update: { profile_id: string; member_id: string; display_name?: string } = {
    profile_id: profileId,
    member_id: memberId,
  };
  if (useLineName && lineDisplayName) update.display_name = lineDisplayName;

  return sb
    .from("club_players")
    .update(update)
    .eq("id", targetPlayerId)
    .eq("club_id", clubId)
    .is("profile_id", null)
    .select("id")
    .maybeSingle();
}

// ---------------------------------------------------------------------------
// Manager: generate / revoke the per-club join link token
// ---------------------------------------------------------------------------

/**
 * decision #15 — the join token lives on the SERIES now (once, forever; stable
 * across every session). Returns the existing series token when one is already
 * set instead of minting a new one, so re-generating never invalidates a link
 * already shared. Legacy per-session `clubs.join_token` values are left alone —
 * old shared links keep working as separate aliases into the same series (join
 * tokens are not exclusive the way a LINE group binding is; see the join page's
 * fallback resolution).
 */
export async function generateClubJoinTokenAction(clubId: string) {
  const session = await getSession();
  if (!session) return await loginRedirect();

  const t = await getTranslations("actions");
  const sb = await createAdminClient();
  if (!(await assertCanManageClub(sb, clubId, session.profileId))) {
    return { error: t("club.noPermission") };
  }

  const series = await ensureSeriesForClub(sb, clubId);
  if (series.join_token) {
    return { ok: true as const, token: series.join_token };
  }

  const token = crypto.randomUUID();
  const { error } = await sb.from("club_series").update({ join_token: token }).eq("id", series.id);
  if (error) {
    console.error("[generateClubJoinTokenAction]", error);
    return { error: t("club.linkTokenFailed") };
  }

  await writeClubAudit(sb, clubId, session, "join_token_generated", "");
  revalidatePath(`/clubs/${clubId}`);
  return { ok: true as const, token };
}

/**
 * Revoke = NOTHING keeps working. Same both-levels rule as
 * `unbindClubLineGroupAction` (see `clearSeriesBinding` — owns the invariant):
 * clears the series-level join token AND every session's legacy
 * `clubs.join_token` under that series — the join page falls back to legacy
 * tokens (`resolveJoinToken`), so a sibling session's pre-series token would
 * otherwise keep resolving into this series after a revoke (the backfill copied
 * the series token FROM one of those sessions, so at least one live alias is
 * guaranteed to exist for migrated clubs).
 */
export async function revokeClubJoinTokenAction(clubId: string) {
  const session = await getSession();
  if (!session) return await loginRedirect();

  const t = await getTranslations("actions");
  const sb = await createAdminClient();
  if (!(await assertCanManageClub(sb, clubId, session.profileId))) {
    return { error: t("club.noPermission") };
  }

  const result = await clearSeriesBinding(sb, clubId, "join_token", "revokeClubJoinTokenAction");
  if (!result.ok) return { error: t("club.linkTokenFailed") };

  await writeClubAudit(sb, clubId, session, "join_token_revoked", "");
  revalidatePath(`/clubs/${clubId}`);
  return { ok: true as const };
}

// ---------------------------------------------------------------------------
// Manager: unbind the LINE group (clears clubs.line_group_id)
// ---------------------------------------------------------------------------

/**
 * Clear the LINE group binding so this club's series is no longer bound.
 * Group billing is gated on the resolved binding, so unbinding disables it until
 * a manager rebinds (posts `ผูกก๊วน <join_token>` in a group again). Binding
 * itself only happens through the webhook — there is no inbound unbind command,
 * so this action is the only way to release the group from the app.
 *
 * ADR 0002 P1 — both-levels clear (see `clearSeriesBinding` — owns the "sharpest
 * trap" invariant: clearing ONLY the series column would silently resurrect the
 * old binding via `resolveLineGroupId`'s legacy fallback).
 */
export async function unbindClubLineGroupAction(clubId: string) {
  const session = await getSession();
  if (!session) return await loginRedirect();

  const t = await getTranslations("actions");
  const sb = await createAdminClient();
  if (!(await assertCanManageClub(sb, clubId, session.profileId))) {
    return { error: t("club.noPermission") };
  }

  const result = await clearSeriesBinding(sb, clubId, "line_group_id", "unbindClubLineGroupAction");
  if (!result.ok) return { error: t("club.unbindGroupFailed") };

  await writeClubAudit(sb, clubId, session, "line_group_unbound", "");
  revalidatePath(`/clubs/${clubId}`);
  return { ok: true as const };
}

// ---------------------------------------------------------------------------
// Player (public): opt into a club via the join link
// ---------------------------------------------------------------------------

/**
 * Called from the /clubs/join/[token] page after the player is logged in.
 *
 * ADR 0002 P1 (decision #4 — amends ADR 0001's "always manager-confirmed"):
 *   (a) the profile is already a `series_members` row of this series AND an
 *       exact+unique still-guest roster row matches their canonical_name →
 *       AUTO-LINK immediately, no manager needed (same rule as keyword
 *       self-link) — returns state "linked".
 *   (b) a member but no clean roster match, or (c) not a member at all →
 *       drop a `pending` row into `club_link_requests` (stamped with BOTH the
 *       active session's club_id — for UI back-compat — and series_id).
 *
 * Idempotent two ways: the legacy UNIQUE(club_id, profile_id) still guards the
 * upsert, AND a pending request is checked by (series_id, profile_id) FIRST so a
 * repeat visit after the active session switches never double-requests.
 * Returns a coarse state only — never any other member's data.
 */
export async function requestClubLinkAction(token: string) {
  const session = await getSession();
  if (!session) return await loginRedirect();

  const t = await getTranslations("actions");
  const sb = await createAdminClient();

  // 1/2. Resolve the token → series + target roster (the series' active session,
  //      decision #3; falls back to a legacy-matched club when the series has no
  //      active pointer yet — see resolveSeriesEntryByToken).
  const entry = await resolveSeriesEntryByToken(sb, token);
  if (!entry || !entry.activeClub) return { error: t("club.linkInvalidToken") };
  const { series, activeClub: club } = entry;

  // 3/4. Already linked to a roster row in the active session, and decision #4's
  //      returning-member auto-link check are independent reads — run them
  //      together instead of serially.
  const [existingRes, memberRes] = await Promise.all([
    sb.from("club_players").select("id").eq("club_id", club.id).eq("profile_id", session.profileId).maybeSingle(),
    sb
      .from("series_members")
      .select("id, canonical_name")
      .eq("series_id", series.id)
      .eq("profile_id", session.profileId)
      .maybeSingle(),
  ]);
  if (existingRes.data) {
    return { ok: true as const, state: "already_linked" as const, clubName: club.name };
  }

  // decision #4 — a returning confirmed member auto-links on an exact+unique
  // still-guest roster-name match, no manager confirmation needed.
  const member = memberRes.data;
  if (member) {
    const { data: rosterRows } = await sb
      .from("club_players")
      .select("id, display_name, profile_id")
      .eq("club_id", club.id);
    const match = classifyRosterMatch((rosterRows ?? []) as RosterCandidate[], member.canonical_name);
    if (match.kind === "unique") {
      const { data: linked, error: linkErr } = await sb
        .from("club_players")
        .update({ profile_id: session.profileId, member_id: member.id })
        .eq("id", match.playerId)
        .eq("club_id", club.id)
        .is("profile_id", null)
        .select("id, display_name")
        .maybeSingle();
      if (!linkErr && linked) {
        await sb
          .from("series_members")
          .update({ last_linked_at: new Date().toISOString() })
          .eq("id", member.id);
        await writeClubAudit(
          sb,
          club.id,
          session,
          "player_linked_autolink",
          `${linked.display_name} ← ${session.profileId} (member auto-link)`,
        );
        revalidatePath(`/clubs/${club.id}`);
        return {
          ok: true as const,
          state: "linked" as const,
          clubName: club.name,
          playerName: linked.display_name,
        };
      }
      // Lost the race (row claimed concurrently) or write failed — fall through
      // to the pool instead of erroring; a manager can still finish the link.
      if (linkErr) console.error("[requestClubLinkAction] autolink", linkErr);
    }
  }

  // 5. Idempotent per series — an existing PENDING request for (series_id,
  //    profile_id) means don't duplicate, regardless of which session's club_id
  //    it was originally stamped with (the active session may have switched).
  if (await hasPendingSeriesRequest(sb, series.id, session.profileId)) {
    return { ok: true as const, state: "pending" as const, clubName: club.name };
  }

  const { error } = await sb
    .from("club_link_requests")
    .upsert(
      { club_id: club.id, series_id: series.id, profile_id: session.profileId, status: "pending" },
      { onConflict: "club_id,profile_id" },
    );
  if (error) {
    console.error("[requestClubLinkAction]", error);
    return { error: t("club.linkRequestFailed") };
  }

  revalidatePath(`/clubs/${club.id}`);
  return { ok: true as const, state: "pending" as const, clubName: club.name };
}

// ---------------------------------------------------------------------------
// Manager: link a pending request to a guest row / dismiss it / unlink
// ---------------------------------------------------------------------------

const LinkSchema = z.object({
  clubId: z.string().uuid(),
  requestId: z.string().uuid(),
  targetPlayerId: z.string().uuid(),
  useLineName: z.boolean().default(false),
});
export type LinkClubPlayerInput = z.infer<typeof LinkSchema>;

export async function linkClubPlayerAction(input: LinkClubPlayerInput) {
  const session = await getSession();
  if (!session) return await loginRedirect();

  const t = await getTranslations("actions");
  const parsed = LinkSchema.safeParse(input);
  if (!parsed.success) return { error: t("club.invalidData") };
  const { clubId, requestId, targetPlayerId, useLineName } = parsed.data;

  const sb = await createAdminClient();
  if (!(await assertCanManageClub(sb, clubId, session.profileId))) {
    return { error: t("club.noPermission") };
  }

  // 1. The request must belong to this club — or its SERIES: the pool lists
  //    pending requests series-wide (they survive active-session pointer moves),
  //    so a request stamped with a sibling session's club_id must still be
  //    actionable from this page.
  const { data: clubScope } = await sb.from("clubs").select("series_id").eq("id", clubId).maybeSingle();
  const requestScope = clubScope?.series_id
    ? `club_id.eq.${clubId},series_id.eq.${clubScope.series_id}`
    : `club_id.eq.${clubId}`;
  const { data: req } = await sb
    .from("club_link_requests")
    .select("id, profile_id, status")
    .eq("id", requestId)
    .or(requestScope)
    .maybeSingle();
  if (!req || req.status !== "pending") return { error: t("club.linkRequestNotFound") };
  const profileId = req.profile_id;

  // 2. Guard: this profile must not already be linked to another row in the club.
  const { data: dup } = await sb
    .from("club_players")
    .select("id, display_name")
    .eq("club_id", clubId)
    .eq("profile_id", profileId)
    .maybeSingle();
  if (dup) return { error: t("club.linkAlreadyLinked", { name: dup.display_name }) };

  // 3. The target must be a guest row (profile_id NULL) in this club.
  const { data: target } = await sb
    .from("club_players")
    .select("id, profile_id, display_name, level_id")
    .eq("id", targetPlayerId)
    .eq("club_id", clubId)
    .maybeSingle();
  if (!target) return { error: t("club.linkTargetNotFound") };
  if (target.profile_id !== null) return { error: t("club.linkTargetNotGuest") };

  // 4. Resolve the profile (name for the optional rename + LINE id for the push).
  const { data: profile } = await sb
    .from("profiles")
    .select("id, display_name, line_user_id")
    .eq("id", profileId)
    .maybeSingle();
  if (!profile) return { error: t("club.linkRequestNotFound") };

  // 5/6. Member write-through (decision #4/#11) + guarded attach — shared with
  //      linkKnownProfileAction, see writeThroughMemberLink.
  const { data: updated, error: upErr } = await writeThroughMemberLink(sb, {
    clubId,
    targetPlayerId,
    profileId,
    targetDisplayName: target.display_name,
    targetLevelId: target.level_id,
    useLineName,
    lineDisplayName: profile.display_name,
  });
  if (upErr) {
    // 23505 = uniq_club_players_profile rejected linking this profile to a second row
    // (a concurrent link won the race). Safe — no false success; a retry hits the
    // step-2 dup guard and gets the clearer "already linked" message.
    console.error("[linkClubPlayerAction]", upErr);
    return { error: t("club.linkFailed") };
  }
  // 0 rows matched = the guest row was linked by a concurrent request between the
  // guard above and this write. Report it instead of a false success.
  if (!updated) return { error: t("club.linkTargetNotGuest") };

  const { error: matchErr } = await sb
    .from("club_link_requests")
    .update({ status: "matched" })
    .eq("id", requestId);
  // Link already succeeded; a failed status flip only leaves a stale pool row (a
  // re-link hits the dup guard, and realtime/refresh re-reads it) — log, don't fail.
  if (matchErr) console.error("[linkClubPlayerAction] status=matched", matchErr);
  await writeClubAudit(sb, clubId, session, "player_linked", `${target.display_name} ← ${profileId}`);

  // 7. Fire-and-forget confirmation push (never blocks or fails the link).
  await pushLinkConfirm(sb, clubId, profile.line_user_id);

  revalidatePath(`/clubs/${clubId}`);
  return { ok: true as const };
}

const DismissSchema = z.object({
  clubId: z.string().uuid(),
  requestId: z.string().uuid(),
});
export type DismissClubLinkInput = z.infer<typeof DismissSchema>;

export async function dismissClubLinkRequestAction(input: DismissClubLinkInput) {
  const session = await getSession();
  if (!session) return await loginRedirect();

  const t = await getTranslations("actions");
  const parsed = DismissSchema.safeParse(input);
  if (!parsed.success) return { error: t("club.invalidData") };
  const { clubId, requestId } = parsed.data;

  const sb = await createAdminClient();
  if (!(await assertCanManageClub(sb, clubId, session.profileId))) {
    return { error: t("club.noPermission") };
  }

  // Series-aware scope — mirrors linkClubPlayerAction: the pool is series-wide,
  // so a sibling session's pending request must be dismissable from this page.
  const { data: clubScope } = await sb.from("clubs").select("series_id").eq("id", clubId).maybeSingle();
  const dismissScope = clubScope?.series_id
    ? `club_id.eq.${clubId},series_id.eq.${clubScope.series_id}`
    : `club_id.eq.${clubId}`;
  const { data: dismissed, error } = await sb
    .from("club_link_requests")
    .update({ status: "rejected" })
    .eq("id", requestId)
    .or(dismissScope)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();
  if (error) {
    console.error("[dismissClubLinkRequestAction]", error);
    return { error: t("club.linkFailed") };
  }
  // 0 rows = already non-pending (matched, or another tab dismissed it): nothing to
  // do — skip the audit + revalidate rather than logging a phantom dismissal.
  if (!dismissed) return { ok: true as const, noop: true as const };

  await writeClubAudit(sb, clubId, session, "link_dismissed", requestId);
  revalidatePath(`/clubs/${clubId}`);
  return { ok: true as const };
}

const UnlinkSchema = z.object({
  clubId: z.string().uuid(),
  playerId: z.string().uuid(),
});
export type UnlinkClubPlayerInput = z.infer<typeof UnlinkSchema>;

/**
 * Detach a LINE account from a roster row: set profile_id (+ member_id) back to
 * NULL (the row becomes a guest again) and return its link request to `pending`
 * so it reappears in the pool for re-matching. display_name is left as-is.
 *
 * Unlink ≠ removing a member (ADR 0002 decision — "Unlink in a session ≠ delete
 * member"): `series_members` is NEVER touched here. The person is still a
 * confirmed member of the series; only this session's attendance row loses the
 * LINE attachment. Removing someone from the series entirely is a separate,
 * not-yet-built action (a mis-linked-person cleanup case, out of P1 scope).
 */
export async function unlinkClubPlayerAction(input: UnlinkClubPlayerInput) {
  const session = await getSession();
  if (!session) return await loginRedirect();

  const t = await getTranslations("actions");
  const parsed = UnlinkSchema.safeParse(input);
  if (!parsed.success) return { error: t("club.invalidData") };
  const { clubId, playerId } = parsed.data;

  const sb = await createAdminClient();
  if (!(await assertCanManageClub(sb, clubId, session.profileId))) {
    return { error: t("club.noPermission") };
  }

  const { data: player } = await sb
    .from("club_players")
    .select("id, profile_id, display_name")
    .eq("id", playerId)
    .eq("club_id", clubId)
    .maybeSingle();
  if (!player) return { error: t("club.linkTargetNotFound") };
  if (!player.profile_id) return { ok: true as const, noop: true as const };
  const profileId = player.profile_id;

  const { error } = await sb
    .from("club_players")
    .update({ profile_id: null, member_id: null })
    .eq("id", playerId)
    .eq("club_id", clubId);
  if (error) {
    console.error("[unlinkClubPlayerAction]", error);
    return { error: t("club.linkFailed") };
  }

  // Return the matched request to the pool (best-effort; the row may have been deleted).
  await sb
    .from("club_link_requests")
    .update({ status: "pending" })
    .eq("club_id", clubId)
    .eq("profile_id", profileId);

  await writeClubAudit(sb, clubId, session, "player_unlinked", `${player.display_name} ✕ ${profileId}`);
  revalidatePath(`/clubs/${clubId}`);
  return { ok: true as const };
}

// ---------------------------------------------------------------------------
// Manager: link a KNOWN profile directly — the "เชื่อม LINE" picker inside the
// guest edit form (no fresh scan; the player opted in on a previous session)
// ---------------------------------------------------------------------------

/**
 * The set of clubs this profile manages (owns or co-admins). Consent for the
 * "known profiles" picker flows from a player having opted into ANY of these clubs.
 */
async function managerClubIds(sb: AdminClient, profileId: string): Promise<string[]> {
  const [owned, adminOf] = await Promise.all([
    sb.from("clubs").select("id").eq("owner_id", profileId),
    sb.from("club_admins").select("club_id").eq("user_id", profileId),
  ]);
  const ids = new Set<string>();
  for (const c of owned.data ?? []) ids.add(c.id);
  for (const a of adminOf.data ?? []) ids.add(a.club_id);
  return [...ids];
}

/**
 * List profiles a manager may link to a guest row WITHOUT asking the player to scan
 * again: anyone who opted into one of the manager's own clubs (a club_link_requests
 * row, ANY status), UNION (ADR 0002 P2 — series-aware) anyone already a confirmed
 * `series_members` row of THIS club's series (profile_id NOT NULL) — a member linked
 * only via a sibling session under the same series is "known" too, even if this
 * particular club never saw its own club_link_requests row. Excludes profiles already
 * linked to a roster row in THIS club. Falls back to the legacy club_link_requests-only
 * behavior when the club has no series yet. Only public profile fields are returned —
 * line_user_id stays server-side.
 */
export async function listLinkableKnownProfilesAction(clubId: string) {
  const session = await getSession();
  if (!session) return await loginRedirect();

  const t = await getTranslations("actions");
  const sb = await createAdminClient();
  if (!(await assertCanManageClub(sb, clubId, session.profileId))) {
    return { error: t("club.noPermission") };
  }

  const [myClubIds, clubRow] = await Promise.all([
    managerClubIds(sb, session.profileId),
    sb.from("clubs").select("series_id").eq("id", clubId).maybeSingle(),
  ]);
  const seriesId = clubRow.data?.series_id as string | null | undefined;

  const candidateIds = new Set<string>();

  // Legacy source: profiles that opted into any of my clubs, excluding ones a
  // manager explicitly dismissed (status=rejected) — a dismiss means "not this
  // person", so the picker must not silently resurface them.
  if (myClubIds.length > 0) {
    const { data: reqs } = await sb
      .from("club_link_requests")
      .select("profile_id")
      .in("club_id", myClubIds)
      .neq("status", "rejected");
    for (const r of reqs ?? []) candidateIds.add(r.profile_id as string);
  }

  // Series-aware source: confirmed members of THIS club's series, regardless of
  // which session they originally opted in from.
  if (seriesId) {
    const { data: members } = await sb
      .from("series_members")
      .select("profile_id")
      .eq("series_id", seriesId)
      .not("profile_id", "is", null);
    for (const m of members ?? []) candidateIds.add(m.profile_id as string);
  }

  if (candidateIds.size === 0) return { ok: true as const, profiles: [] as LinkableKnownProfile[] };

  // Exclude profiles already linked to a roster row in THIS club.
  const { data: linked } = await sb
    .from("club_players")
    .select("profile_id")
    .eq("club_id", clubId)
    .not("profile_id", "is", null);
  const linkedSet = new Set((linked ?? []).map((l) => l.profile_id));
  const freeIds = [...candidateIds].filter((id) => !linkedSet.has(id));
  if (freeIds.length === 0) return { ok: true as const, profiles: [] as LinkableKnownProfile[] };

  const { data: profiles, error } = await sb
    .from("profiles")
    .select("id, display_name, picture_url")
    .in("id", freeIds)
    .order("display_name", { ascending: true });
  if (error) {
    console.error("[listLinkableKnownProfilesAction]", error);
    return { error: t("club.linkFailed") };
  }

  return { ok: true as const, profiles: (profiles ?? []) as LinkableKnownProfile[] };
}

const LinkKnownSchema = z.object({
  clubId: z.string().uuid(),
  targetPlayerId: z.string().uuid(),
  profileId: z.string().uuid(),
  useLineName: z.boolean().default(false),
});
export type LinkKnownProfileInput = z.infer<typeof LinkKnownSchema>;

/**
 * Attach a KNOWN profile (see listLinkableKnownProfilesAction) to a guest row directly,
 * skipping the pool. Mirrors linkClubPlayerAction's guards but keys off profileId instead
 * of a pending request, and re-verifies the profile is genuinely one the manager may link
 * (has opted into one of the manager's clubs) so a forged profileId cannot be attached.
 */
export async function linkKnownProfileAction(input: LinkKnownProfileInput) {
  const session = await getSession();
  if (!session) return await loginRedirect();

  const t = await getTranslations("actions");
  const parsed = LinkKnownSchema.safeParse(input);
  if (!parsed.success) return { error: t("club.invalidData") };
  const { clubId, targetPlayerId, profileId, useLineName } = parsed.data;

  const sb = await createAdminClient();
  if (!(await assertCanManageClub(sb, clubId, session.profileId))) {
    return { error: t("club.noPermission") };
  }

  // 1. Re-verify consent: the profile must have opted into one of the manager's own clubs.
  //    Closes the hole where a forged profileId would attach an arbitrary LINE account.
  const myClubIds = await managerClubIds(sb, session.profileId);
  if (myClubIds.length === 0) return { error: t("club.linkRequestNotFound") };
  const { data: consent } = await sb
    .from("club_link_requests")
    .select("id")
    .eq("profile_id", profileId)
    .in("club_id", myClubIds)
    .neq("status", "rejected") // a dismissed request must not be re-linkable — mirrors the picker list
    .limit(1)
    .maybeSingle();
  if (!consent) return { error: t("club.linkRequestNotFound") };

  // 2. Guard: this profile must not already be linked to another row in the club.
  const { data: dup } = await sb
    .from("club_players")
    .select("id, display_name")
    .eq("club_id", clubId)
    .eq("profile_id", profileId)
    .maybeSingle();
  if (dup) return { error: t("club.linkAlreadyLinked", { name: dup.display_name }) };

  // 3. The target must be a guest row (profile_id NULL) in this club.
  const { data: target } = await sb
    .from("club_players")
    .select("id, profile_id, display_name, level_id")
    .eq("id", targetPlayerId)
    .eq("club_id", clubId)
    .maybeSingle();
  if (!target) return { error: t("club.linkTargetNotFound") };
  if (target.profile_id !== null) return { error: t("club.linkTargetNotGuest") };

  // 4. Resolve the profile (name for the optional rename + LINE id for the push).
  const { data: profile } = await sb
    .from("profiles")
    .select("id, display_name, line_user_id")
    .eq("id", profileId)
    .maybeSingle();
  if (!profile) return { error: t("club.linkRequestNotFound") };

  // 5/6. Member write-through (decision #4/#11) + guarded attach — shared with
  //      linkClubPlayerAction, see writeThroughMemberLink.
  const { data: updated, error: upErr } = await writeThroughMemberLink(sb, {
    clubId,
    targetPlayerId,
    profileId,
    targetDisplayName: target.display_name,
    targetLevelId: target.level_id,
    useLineName,
    lineDisplayName: profile.display_name,
  });
  if (upErr) {
    console.error("[linkKnownProfileAction]", upErr);
    return { error: t("club.linkFailed") };
  }
  // 0 rows matched = the guest row was claimed by a concurrent link. No false success.
  if (!updated) return { error: t("club.linkTargetNotGuest") };

  // 7. If a pending pool request for this profile exists in THIS club, retire it so the
  //    pool and the picker stay consistent (best-effort — absent when the player only
  //    scanned another of the manager's clubs).
  const { error: matchErr } = await sb
    .from("club_link_requests")
    .update({ status: "matched" })
    .eq("club_id", clubId)
    .eq("profile_id", profileId)
    .eq("status", "pending");
  if (matchErr) console.error("[linkKnownProfileAction] status=matched", matchErr);

  await writeClubAudit(sb, clubId, session, "player_linked", `${target.display_name} ← ${profileId}`);

  // 8. Fire-and-forget confirmation push (never blocks or fails the link).
  await pushLinkConfirm(sb, clubId, profile.line_user_id);

  revalidatePath(`/clubs/${clubId}`);
  return { ok: true as const };
}
