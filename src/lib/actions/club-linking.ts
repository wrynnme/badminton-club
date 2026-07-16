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
 *      or dismisses it (`dismissSeriesLinkRequestAction`).
 *
 * Every successful link (manager-confirmed or auto) writes through to the
 * series member registry (`upsertSeriesMember`) and stamps the roster row's
 * `member_id`, so the NEXT session inherits the link without re-confirming.
 *
 * All reads/writes use the service-role client; `club_link_requests` is
 * service-role-only (RLS on, no policy) and `profiles.line_user_id` never
 * reaches the client.
 */

import { revalidateClubTree } from "@/lib/club/revalidate";
import { z } from "zod";
import { getTranslations } from "next-intl/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getSession, type SessionPayload } from "@/lib/auth/session";
import { loginRedirect, assertCanManageClub } from "@/lib/club/permissions";
import { pushTextToUser } from "@/lib/notification/line-club";
import { classifyRosterMatch, type RosterCandidate } from "@/lib/club/line-self-link";
import {
  clearBindingBySeriesId,
  ensureSeriesForClub,
  hasPendingSeriesRequest,
  latestSessionOfSeries,
  poolSessionlessRequest,
  resolveSeriesEntryByToken,
  upsertSeriesMember,
} from "@/lib/club/series.server";
import { assertCanManageSeries } from "@/lib/club/series-permissions";
import type { ClubSeries, LinkableKnownProfile } from "@/lib/types";

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
 * Fire-and-forget "you're now linked" push to a freshly-linked player — never
 * blocks or fails the link; no-op without a LINE id. `name` is the ก๊วน (series)
 * or session name shown in the message. Shared by every manager-link action.
 */
function pushLinkConfirmNamed(name: string, lineUserId: string | null) {
  if (!lineUserId) return;
  void pushTextToUser(
    lineUserId,
    `✅ เชื่อมบัญชี LINE กับก๊วน "${name}" เรียบร้อยแล้ว — จากนี้จะได้รับบิลและการแจ้งเตือนทาง LINE`,
  );
}

/** Club-keyed wrapper: fetches the session name first (awaited; push is not). */
async function pushLinkConfirm(sb: AdminClient, clubId: string, lineUserId: string | null) {
  if (!lineUserId) return;
  const { data: club } = await sb.from("clubs").select("name").eq("id", clubId).maybeSingle();
  pushLinkConfirmNamed(club?.name ?? "", lineUserId);
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
// Player (public): opt into a club via the join link
// ---------------------------------------------------------------------------

/**
 * Called from the /clubs/join/[token] page after the player is logged in.
 *
 * ADR 0002 P1 (decision #4 — amends ADR 0001's "always manager-confirmed"),
 * series-first since 2026-07-16 (a series with NO session is a valid target —
 * the member registry is where a link lands; the roster catches up later):
 *   (a) the profile is already a `series_members` row of this series AND an
 *       exact+unique still-guest roster row matches their canonical_name →
 *       AUTO-LINK immediately, no manager needed (same rule as keyword
 *       self-link) — returns state "linked".
 *   (a') no session open: an already-linked member simply confirms — state
 *       "member" ("จะถูกดึงเข้ารอบตีภายหลัง").
 *   (b) a member but no clean roster match, or (c) not a member at all →
 *       drop a `pending` row into `club_link_requests` (club_id = the active
 *       session when one exists, else NULL — migration 20260716000200).
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

  // 1/2. Resolve the token → series (+ its active session, when one exists —
  //      see resolveSeriesEntryByToken). Only an unresolvable token errors.
  const entry = await resolveSeriesEntryByToken(sb, token);
  if (!entry) return { error: t("club.linkInvalidToken") };
  const { series, activeClub: club } = entry;

  // 3/4. Already linked to a roster row in the active session, and decision #4's
  //      returning-member auto-link check are independent reads — run them
  //      together instead of serially.
  const [existingRes, memberRes] = await Promise.all([
    club
      ? sb.from("club_players").select("id").eq("club_id", club.id).eq("profile_id", session.profileId).maybeSingle()
      : Promise.resolve({ data: null }),
    sb
      .from("series_members")
      .select("id, canonical_name")
      .eq("series_id", series.id)
      .eq("profile_id", session.profileId)
      .maybeSingle(),
  ]);
  if (existingRes.data && club) {
    return { ok: true as const, state: "already_linked" as const, clubName: club.name };
  }

  const member = memberRes.data;

  // (a') sessionless: a confirmed member has nothing to attach to yet — confirm
  // the durable registry link; the next รอบตี picks them up (seed / manager add).
  if (!club) {
    if (member) {
      return { ok: true as const, state: "member" as const, clubName: series.name };
    }
    if (await hasPendingSeriesRequest(sb, series.id, session.profileId)) {
      return { ok: true as const, state: "pending" as const, clubName: series.name };
    }
    // Insert-or-revive: a dismissed/stale club-less row must come back to
    // pending here (see poolSessionlessRequest) — same resurrect semantics as
    // the session-ful upsert below.
    const pooled = await poolSessionlessRequest(sb, series.id, session.profileId, "requestClubLinkAction");
    if (!pooled) return { error: t("club.linkRequestFailed") };
    revalidateClubTree();
    return { ok: true as const, state: "pending" as const, clubName: series.name };
  }

  // decision #4 — a returning confirmed member auto-links on an exact+unique
  // still-guest roster-name match, no manager confirmation needed.
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
        revalidateClubTree();
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

  revalidateClubTree();
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

  revalidateClubTree();
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
  revalidateClubTree();
  return { ok: true as const };
}

// ---------------------------------------------------------------------------
// Manager (series-first, 2026-07-16): series-keyed variants of the link-controls
// actions. The controls card lives on the series settings tab and must work for
// a series with ZERO sessions, so these gate on `assertCanManageSeries` instead
// of a per-session `assertCanManageClub`. `club_audit_logs` is keyed by club_id
// (NOT NULL) — each action audits to the series' active session when one
// exists, else the event goes unaudited (the registry/binding row itself is the
// durable record).
// ---------------------------------------------------------------------------

// Same two-layer rule as every action here: a malformed id must come back as a
// clean {error}, not blow up inside the permission check.
const SeriesIdSchema = z.string().uuid();

/**
 * Shared prologue of every series-keyed action below: session -> uuid check ->
 * manage-permission gate -> series row. Errors come back pre-translated so each
 * action stays a plain early-return.
 */
async function seriesManagerGate(
  seriesId: string,
): Promise<
  | { error: string }
  | { error?: undefined; sb: AdminClient; session: SessionPayload; t: Awaited<ReturnType<typeof getTranslations>>; series: ClubSeries }
> {
  const session = await getSession();
  if (!session) return await loginRedirect();

  const t = await getTranslations("actions");
  if (!SeriesIdSchema.safeParse(seriesId).success) return { error: t("club.invalidData") };
  const sb = await createAdminClient();
  if (!(await assertCanManageSeries(sb, seriesId, session.profileId))) {
    return { error: t("club.noPermission") };
  }
  const { data } = await sb.from("club_series").select("*").eq("id", seriesId).maybeSingle();
  if (!data) return { error: t("club.invalidData") };
  return { sb, session, t, series: data as ClubSeries };
}

async function auditToActiveSession(
  sb: AdminClient,
  series: Pick<ClubSeries, "active_session_id">,
  session: SessionPayload,
  eventType: string,
  detail: string,
) {
  if (!series.active_session_id) return;
  await writeClubAudit(sb, series.active_session_id, session, eventType, detail);
}

/** Series-keyed twin of generateClubJoinTokenAction — same "return the existing
 *  token instead of minting" rule (decision #15). */
export async function generateSeriesJoinTokenAction(seriesId: string) {
  const gate = await seriesManagerGate(seriesId);
  if (gate.error !== undefined) return { error: gate.error };
  const { sb, session, t, series } = gate;

  if (series.join_token) {
    return { ok: true as const, token: series.join_token };
  }

  const token = crypto.randomUUID();
  const { error } = await sb.from("club_series").update({ join_token: token }).eq("id", seriesId);
  if (error) {
    console.error("[generateSeriesJoinTokenAction]", error);
    return { error: t("club.linkTokenFailed") };
  }

  await auditToActiveSession(sb, series, session, "join_token_generated", "");
  revalidateClubTree();
  return { ok: true as const, token };
}

/** revoke/unbind share everything but the column + audit event + error key —
 *  both-levels clear via clearBindingBySeriesId (series column + every legacy
 *  session alias). */
async function clearSeriesBindingAction(
  seriesId: string,
  column: "join_token" | "line_group_id",
  eventType: string,
  errorKey: "club.linkTokenFailed" | "club.unbindGroupFailed",
  caller: string,
) {
  const gate = await seriesManagerGate(seriesId);
  if (gate.error !== undefined) return { error: gate.error };
  const { sb, session, t, series } = gate;

  const result = await clearBindingBySeriesId(sb, seriesId, column, caller);
  if (!result.ok) return { error: t(errorKey) };

  await auditToActiveSession(sb, series, session, eventType, "");
  revalidateClubTree();
  return { ok: true as const };
}

export async function revokeSeriesJoinTokenAction(seriesId: string) {
  return clearSeriesBindingAction(
    seriesId, "join_token", "join_token_revoked", "club.linkTokenFailed", "revokeSeriesJoinTokenAction");
}

export async function unbindSeriesLineGroupAction(seriesId: string) {
  return clearSeriesBindingAction(
    seriesId, "line_group_id", "line_group_unbound", "club.unbindGroupFailed", "unbindSeriesLineGroupAction");
}

const DismissSeriesSchema = z.object({
  seriesId: z.string().uuid(),
  requestId: z.string().uuid(),
});
export type DismissSeriesLinkInput = z.infer<typeof DismissSeriesSchema>;

/** Series-keyed twin of dismissClubLinkRequestAction — the pool is series-wide
 *  and must be manageable with zero sessions. */
export async function dismissSeriesLinkRequestAction(input: DismissSeriesLinkInput) {
  const parsedInput = DismissSeriesSchema.safeParse(input);
  if (!parsedInput.success) {
    return { error: (await getTranslations("actions"))("club.invalidData") };
  }
  const { seriesId, requestId } = parsedInput.data;

  const gate = await seriesManagerGate(seriesId);
  if (gate.error !== undefined) return { error: gate.error };
  const { sb, session, t, series } = gate;

  const { data: dismissed, error } = await sb
    .from("club_link_requests")
    .update({ status: "rejected" })
    .eq("id", requestId)
    .eq("series_id", seriesId)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();
  if (error) {
    console.error("[dismissSeriesLinkRequestAction]", error);
    return { error: t("club.linkFailed") };
  }
  if (!dismissed) return { ok: true as const, noop: true as const };

  await auditToActiveSession(sb, series, session, "link_dismissed", requestId);
  revalidateClubTree();
  return { ok: true as const };
}

const LinkToMemberSchema = z.object({
  seriesId: z.string().uuid(),
  requestId: z.string().uuid(),
  memberId: z.string().uuid(),
});
export type LinkRequestToMemberInput = z.infer<typeof LinkToMemberSchema>;

/**
 * Pair a pending request with a NAME-ONLY member of the registry (series-first,
 * 2026-07-16) — the registry twin of linkClubPlayerAction: set the member's
 * profile_id (upgrade in place, decision #11), retire the request, and — when
 * the active session's roster carries a row seeded from this member — link that
 * row too, so the current รอบตี reflects the pairing immediately.
 */
/**
 * Shared core of linkRequestToMemberAction / linkSeriesMemberToProfileAction:
 * dup-guard → claim the name-only member row (race-safe: `.is("profile_id",
 * null)` + partial UNIQUE (series_id, profile_id) WHERE profile_id IS NOT
 * NULL) → best-effort roster write-through (active ?? latest session — matches
 * the settings-tab UI) → audit. Callers keep their own trigger bookkeeping
 * (pool request vs direct picker), confirm push, and revalidate.
 */
async function linkProfileToNameOnlyMember(args: {
  sb: AdminClient;
  session: SessionPayload;
  t: Awaited<ReturnType<typeof getTranslations>>;
  series: ClubSeries;
  memberId: string;
  profileId: string;
  caller: string;
}): Promise<{ ok: true; memberName: string; lineUserId: string | null } | { error: string }> {
  const { sb, session, t, series, memberId, profileId, caller } = args;
  const seriesId = series.id;

  // Guard: this profile must not already be a linked member of the series.
  const { data: dup } = await sb
    .from("series_members")
    .select("id, canonical_name")
    .eq("series_id", seriesId)
    .eq("profile_id", profileId)
    .maybeSingle();
  if (dup) return { error: t("club.linkAlreadyLinked", { name: dup.canonical_name }) };

  // The target must be a name-only member (profile_id NULL) of this series.
  const { data: target } = await sb
    .from("series_members")
    .select("id, profile_id, canonical_name")
    .eq("id", memberId)
    .eq("series_id", seriesId)
    .maybeSingle();
  if (!target) return { error: t("club.linkTargetNotFound") };
  if (target.profile_id !== null) return { error: t("club.linkTargetNotGuest") };

  // Resolve the profile (LINE id for the caller's confirm push).
  const { data: profile } = await sb
    .from("profiles")
    .select("id, line_user_id")
    .eq("id", profileId)
    .maybeSingle();
  if (!profile) return { error: t("club.linkRequestNotFound") };

  const { data: upgraded, error: upErr } = await sb
    .from("series_members")
    .update({ profile_id: profileId, last_linked_at: new Date().toISOString() })
    .eq("id", memberId)
    .eq("series_id", seriesId)
    .is("profile_id", null)
    .select("id")
    .maybeSingle();
  if (upErr) {
    console.error(`[${caller}]`, upErr);
    return { error: t("club.linkFailed") };
  }
  if (!upgraded) return { error: t("club.linkTargetNotGuest") };

  // Best-effort roster write-through: the current รอบตี's row seeded from this
  // member (if any, still guest) picks up the link immediately. A failure (e.g.
  // uniq_club_players_profile — the profile already links another row there)
  // must not fail the member link, but must not vanish either.
  const writeThroughClubId = series.active_session_id ?? (await latestSessionOfSeries(sb, seriesId));
  if (writeThroughClubId) {
    const { error: rosterErr } = await sb
      .from("club_players")
      .update({ profile_id: profileId })
      .eq("club_id", writeThroughClubId)
      .eq("member_id", memberId)
      .is("profile_id", null);
    if (rosterErr) console.error(`[${caller}] roster write-through`, rosterErr);
  }

  await auditToActiveSession(
    sb,
    series,
    session,
    "player_linked",
    `${target.canonical_name} ← ${profileId} (member)`,
  );

  return { ok: true, memberName: target.canonical_name as string, lineUserId: (profile.line_user_id as string | null) ?? null };
}

export async function linkRequestToMemberAction(input: LinkRequestToMemberInput) {
  const parsedInput = LinkToMemberSchema.safeParse(input);
  if (!parsedInput.success) {
    return { error: (await getTranslations("actions"))("club.invalidData") };
  }
  const { seriesId, requestId, memberId } = parsedInput.data;

  const gate = await seriesManagerGate(seriesId);
  if (gate.error !== undefined) return { error: gate.error };
  const { sb, session, t, series } = gate;

  // The request must belong to this series and still be pending.
  const { data: req } = await sb
    .from("club_link_requests")
    .select("id, profile_id, status")
    .eq("id", requestId)
    .eq("series_id", seriesId)
    .maybeSingle();
  if (!req || req.status !== "pending") return { error: t("club.linkRequestNotFound") };

  const linked = await linkProfileToNameOnlyMember({
    sb, session, t, series,
    memberId,
    profileId: req.profile_id as string,
    caller: "linkRequestToMemberAction",
  });
  if ("error" in linked) return linked;

  const { error: matchErr } = await sb
    .from("club_link_requests")
    .update({ status: "matched" })
    .eq("id", requestId);
  if (matchErr) console.error("[linkRequestToMemberAction] status=matched", matchErr);

  pushLinkConfirmNamed(series.name, linked.lineUserId);
  revalidateClubTree();
  return { ok: true as const };
}

export type SeriesLinkableProfile = { id: string; display_name: string; picture_url: string | null };

/**
 * Profiles a manager may pair with a name-only member from the edit dialog —
 * consent-safe: ONLY profiles that already have a relationship with THIS ก๊วน
 * ((a) any club_link_requests row of the series — they explicitly asked to
 * link here, any status — or (b) ever linked into a roster of any รอบตี under
 * the series). Never broader (PII minimum), never `line_user_id`. Profiles
 * already linked as a member of this series are filtered out.
 */
export async function listSeriesLinkableProfilesAction(seriesId: string) {
  const gate = await seriesManagerGate(seriesId);
  if (gate.error !== undefined) return { error: gate.error };
  const { sb } = gate;

  const [reqRes, rosterRes, memberRes] = await Promise.all([
    sb.from("club_link_requests").select("profile_id").eq("series_id", seriesId),
    sb
      .from("club_players")
      .select("profile_id, club:clubs!inner(series_id)")
      .eq("club.series_id", seriesId)
      .not("profile_id", "is", null),
    sb.from("series_members").select("profile_id").eq("series_id", seriesId).not("profile_id", "is", null),
  ]);

  const alreadyMember = new Set((memberRes.data ?? []).map((r) => r.profile_id as string));
  const candidateIds = [
    ...new Set(
      [...(reqRes.data ?? []), ...(rosterRes.data ?? [])]
        .map((r) => r.profile_id as string | null)
        .filter((id): id is string => !!id && !alreadyMember.has(id)),
    ),
  ];
  if (candidateIds.length === 0) return { ok: true as const, profiles: [] as SeriesLinkableProfile[] };

  const { data: profiles, error } = await sb
    .from("profiles")
    .select("id, display_name, picture_url")
    .in("id", candidateIds)
    .order("display_name", { ascending: true });
  if (error) {
    console.error("[listSeriesLinkableProfilesAction]", error);
    return { error: (await getTranslations("actions"))("club.loadKnownProfilesFailed") };
  }
  return { ok: true as const, profiles: (profiles ?? []) as SeriesLinkableProfile[] };
}

const LinkMemberToProfileSchema = z.object({
  seriesId: z.string().uuid(),
  memberId: z.string().uuid(),
  profileId: z.string().uuid(),
});
export type LinkSeriesMemberToProfileInput = z.infer<typeof LinkMemberToProfileSchema>;

/**
 * Pair a name-only member with a KNOWN profile picked in the member edit
 * dialog (no pool request needed). The profile must pass the SAME consent set
 * as listSeriesLinkableProfilesAction — re-checked server-side so a forged
 * profileId outside the series' relationships is rejected.
 */
export async function linkSeriesMemberToProfileAction(input: LinkSeriesMemberToProfileInput) {
  const parsedInput = LinkMemberToProfileSchema.safeParse(input);
  if (!parsedInput.success) {
    return { error: (await getTranslations("actions"))("club.invalidData") };
  }
  const { seriesId, memberId, profileId } = parsedInput.data;

  const gate = await seriesManagerGate(seriesId);
  if (gate.error !== undefined) return { error: gate.error };
  const { sb, session, t, series } = gate;

  // Consent re-check (anti-IDOR): the profile must already relate to this ก๊วน.
  const [reqRes, rosterRes] = await Promise.all([
    sb.from("club_link_requests").select("id").eq("series_id", seriesId).eq("profile_id", profileId).limit(1),
    sb
      .from("club_players")
      .select("id, club:clubs!inner(series_id)")
      .eq("club.series_id", seriesId)
      .eq("profile_id", profileId)
      .limit(1),
  ]);
  const hasConsent = (reqRes.data ?? []).length > 0 || (rosterRes.data ?? []).length > 0;
  if (!hasConsent) return { error: t("club.linkTargetNotFound") };

  const linked = await linkProfileToNameOnlyMember({
    sb, session, t, series, memberId, profileId,
    caller: "linkSeriesMemberToProfileAction",
  });
  if ("error" in linked) return linked;

  // Retire any still-pending request from this profile in the series (both
  // club-keyed and sessionless rows) — the pairing just satisfied it.
  const { error: matchErr } = await sb
    .from("club_link_requests")
    .update({ status: "matched" })
    .eq("series_id", seriesId)
    .eq("profile_id", profileId)
    .eq("status", "pending");
  if (matchErr) console.error("[linkSeriesMemberToProfileAction] status=matched", matchErr);

  pushLinkConfirmNamed(series.name, linked.lineUserId);
  revalidateClubTree();
  return { ok: true as const };
}

const UnlinkMemberSchema = z.object({
  seriesId: z.string().uuid(),
  memberId: z.string().uuid(),
});
export type UnlinkSeriesMemberInput = z.infer<typeof UnlinkMemberSchema>;

/**
 * Detach the LINE account from a member (edit-dialog "ยกเลิกการเชื่อม").
 * Registry-level only: `club_players` rows of past AND current รอบตี keep
 * their profile_id — billing/attendance history must not be rewritten by a
 * registry correction; a session-level unlink exists separately when the
 * current roster row itself was mislinked. Future เปิดรอบตี seeds this member
 * name-only again.
 */
export async function unlinkSeriesMemberLineAction(input: UnlinkSeriesMemberInput) {
  const parsedInput = UnlinkMemberSchema.safeParse(input);
  if (!parsedInput.success) {
    return { error: (await getTranslations("actions"))("club.invalidData") };
  }
  const { seriesId, memberId } = parsedInput.data;

  const gate = await seriesManagerGate(seriesId);
  if (gate.error !== undefined) return { error: gate.error };
  const { sb, session, t, series } = gate;

  const { data: cleared, error } = await sb
    .from("series_members")
    .update({ profile_id: null })
    .eq("id", memberId)
    .eq("series_id", seriesId)
    .not("profile_id", "is", null)
    .select("canonical_name")
    .maybeSingle();
  if (error) {
    console.error("[unlinkSeriesMemberLineAction]", error);
    return { error: t("club.unlinkFailed") };
  }
  if (!cleared) return { error: t("club.linkTargetNotFound") };

  await auditToActiveSession(
    sb,
    series,
    session,
    "player_unlinked",
    `${cleared.canonical_name} (member unlink)`,
  );
  revalidateClubTree();
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

  revalidateClubTree();
  return { ok: true as const };
}
