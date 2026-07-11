"use server";

/**
 * club-linking.ts — LINE linking for club rosters (see docs/adr/0001).
 *
 * Attaches a real LINE account (a `profiles` row) to an existing GUEST
 * `club_players` row (`profile_id IS NULL`) so outbound pushes (bills,
 * notifications) reach a player who was previously unreachable (skippedNoLine).
 *
 * Mechanism = manager-confirmed pool (NOT auto-claim):
 *   1. A manager generates a per-club `join_token` and shares the join link.
 *   2. A player opens /clubs/join/[token], logs in with LINE, and
 *      `requestClubLinkAction` drops a `pending` row into `club_link_requests`.
 *   3. A manager links a pending request to a guest row (`linkClubPlayerAction`)
 *      or dismisses it (`dismissClubLinkRequestAction`).
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

// ---------------------------------------------------------------------------
// Manager: generate / revoke the per-club join link token
// ---------------------------------------------------------------------------

export async function generateClubJoinTokenAction(clubId: string) {
  const session = await getSession();
  if (!session) return await loginRedirect();

  const t = await getTranslations("actions");
  const sb = await createAdminClient();
  if (!(await assertCanManageClub(sb, clubId, session.profileId))) {
    return { error: t("club.noPermission") };
  }

  const token = crypto.randomUUID();
  const { error } = await sb.from("clubs").update({ join_token: token }).eq("id", clubId);
  if (error) {
    console.error("[generateClubJoinTokenAction]", error);
    return { error: t("club.linkTokenFailed") };
  }

  await writeClubAudit(sb, clubId, session, "join_token_generated", "");
  revalidatePath(`/clubs/${clubId}`);
  return { ok: true as const, token };
}

export async function revokeClubJoinTokenAction(clubId: string) {
  const session = await getSession();
  if (!session) return await loginRedirect();

  const t = await getTranslations("actions");
  const sb = await createAdminClient();
  if (!(await assertCanManageClub(sb, clubId, session.profileId))) {
    return { error: t("club.noPermission") };
  }

  const { error } = await sb.from("clubs").update({ join_token: null }).eq("id", clubId);
  if (error) {
    console.error("[revokeClubJoinTokenAction]", error);
    return { error: t("club.linkTokenFailed") };
  }

  await writeClubAudit(sb, clubId, session, "join_token_revoked", "");
  revalidatePath(`/clubs/${clubId}`);
  return { ok: true as const };
}

// ---------------------------------------------------------------------------
// Player (public): opt into a club via the join link
// ---------------------------------------------------------------------------

/**
 * Called from the /clubs/join/[token] page after the player is logged in.
 * Idempotent per UNIQUE(club_id, profile_id): a repeat login upserts the same
 * row back to `pending` rather than duplicating. Returns a coarse state only —
 * never any other member's data.
 */
export async function requestClubLinkAction(token: string) {
  const session = await getSession();
  if (!session) return await loginRedirect();

  const t = await getTranslations("actions");
  const sb = await createAdminClient();

  const { data: club } = await sb
    .from("clubs")
    .select("id, name")
    .eq("join_token", token)
    .maybeSingle();
  if (!club) return { error: t("club.linkInvalidToken") };

  // Already linked to a roster row in this club → nothing to do.
  const { data: existing } = await sb
    .from("club_players")
    .select("id")
    .eq("club_id", club.id)
    .eq("profile_id", session.profileId)
    .maybeSingle();
  if (existing) {
    return { ok: true as const, state: "already_linked" as const, clubName: club.name };
  }

  const { error } = await sb
    .from("club_link_requests")
    .upsert(
      { club_id: club.id, profile_id: session.profileId, status: "pending" },
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

  // 1. The request must belong to this club and still be pending.
  const { data: req } = await sb
    .from("club_link_requests")
    .select("id, profile_id, status")
    .eq("id", requestId)
    .eq("club_id", clubId)
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
    .select("id, profile_id, display_name")
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

  // 5. Attach: set profile_id (+ optionally adopt the LINE name). Two guards make this
  //    race-safe: `.is("profile_id", null)` stops two profiles claiming the SAME row,
  //    and the partial UNIQUE index uniq_club_players_profile on club_players
  //    (club_id, profile_id) WHERE profile_id IS NOT NULL (migration 20260711000300)
  //    stops ONE profile being linked to TWO different rows at once.
  const update: { profile_id: string; display_name?: string } = { profile_id: profileId };
  if (useLineName && profile.display_name) update.display_name = profile.display_name;

  const { data: updated, error: upErr } = await sb
    .from("club_players")
    .update(update)
    .eq("id", targetPlayerId)
    .eq("club_id", clubId)
    .is("profile_id", null)
    .select("id")
    .maybeSingle();
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

  // 6. Fire-and-forget confirmation push (never blocks or fails the link).
  if (profile.line_user_id) {
    const { data: club } = await sb.from("clubs").select("name").eq("id", clubId).maybeSingle();
    const clubName = club?.name ?? "";
    void pushTextToUser(
      profile.line_user_id,
      `✅ เชื่อมบัญชี LINE กับก๊วน "${clubName}" เรียบร้อยแล้ว — จากนี้จะได้รับบิลและการแจ้งเตือนทาง LINE`,
    );
  }

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

  const { data: dismissed, error } = await sb
    .from("club_link_requests")
    .update({ status: "rejected" })
    .eq("id", requestId)
    .eq("club_id", clubId)
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
 * Detach a LINE account from a roster row: set profile_id back to NULL (the row
 * becomes a guest again) and return its link request to `pending` so it reappears
 * in the pool for re-matching. display_name is left as-is.
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
    .update({ profile_id: null })
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
