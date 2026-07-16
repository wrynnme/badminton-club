/**
 * src/app/api/line/webhook/route.ts
 *
 * Inbound LINE Messaging API webhook — signature-verified.
 *
 * Two inbound text commands, both in a group:
 *
 *   1. Bind (manager)      ผูกก๊วน <join_token>
 *      Captures `source.groupId` (LINE exposes a groupId only through webhook
 *      events — there is no group-list API) and stores it on the club's SERIES
 *      (`club_series.line_group_id` — ADR 0002, "once, forever"; see
 *      `@/lib/club/series.server`). A legacy `clubs.join_token` is still accepted
 *      and lazily migrated onto a series via `ensureSeriesForClub`.
 *
 *   2. Self-link (player)  เชื่อมไลน์ <ชื่อในโพย>  (แท็กบอทหรือไม่ก็ได้)
 *      A player types their name after the keyword to link their LINE account
 *      themselves — a fast-path alongside the manager-confirmed pool. The name
 *      is matched against the member registry (primary — works even before any
 *      รอบตี exists) plus the active session's roster (supplementary); a clean
 *      unique match auto-links, anything else drops into the pool. Parsing lives
 *      in `@/lib/club/line-self-link`, classification in
 *      `@/lib/club/link-target-match` (both pure, tested); the DB orchestration
 *      is `resolveSelfLink` below.
 *
 * No slip/image processing exists (that feature was removed in v0.22.0); this is
 * not a revival of it.
 *
 * Security: HMAC-SHA256 signature verified against LINE_MESSAGING_CHANNEL_SECRET
 * before anything else. Heavy work runs in `after()` so LINE gets a fast 200 ack.
 *
 * Required env vars:
 *   LINE_MESSAGING_CHANNEL_SECRET        — webhook signature verification
 *   LINE_MESSAGING_CHANNEL_ACCESS_TOKEN  — reply confirmation to the group
 */

import { NextRequest, NextResponse, after } from "next/server";
import {
  verifyLineSignature,
  replyMessage,
  getGroupMemberProfile,
} from "@/lib/notification/line-club";
import { upsertLineProfile } from "@/lib/auth/line-profile";
import { parseSelfLinkCommand, type Mentionee } from "@/lib/club/line-self-link";
import {
  classifyLinkTarget,
  type MemberCandidate,
  type RosterLinkCandidate,
} from "@/lib/club/link-target-match";
import {
  findGroupBindingConflict,
  hasPendingSeriesRequest,
  poolSessionlessRequest,
  resolveSeriesEntryByGroupId,
  resolveSeriesEntryByToken,
  upsertSeriesMember,
} from "@/lib/club/series.server";
import { createAdminClient } from "@/lib/supabase/server";
import { getAppSettings } from "@/lib/app-settings";
import { resolveBotMessage } from "@/lib/bot-messages";

// Manager posts "ผูกก๊วน <join_token>" in the group to bind it.
const BIND_RE = /^\s*ผูกก๊วน\s+(\S+)\s*$/;

type LineSource = { type?: string; groupId?: string; userId?: string };
type LineMention = { mentionees?: Mentionee[] };
type LineEvent = {
  type?: string;
  replyToken?: string;
  source?: LineSource;
  message?: { type?: string; text?: string; mention?: LineMention };
};
type LineWebhookBody = { events?: LineEvent[] };

// ---------------------------------------------------------------------------
// GET — health check (harmless, helps confirm deployment)
// ---------------------------------------------------------------------------

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ ok: true });
}

// ---------------------------------------------------------------------------
// POST — verify signature, ack fast, process bind commands after the response.
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest): Promise<NextResponse> {
  // Read raw body FIRST — LINE signs the raw bytes.
  const rawBody = await req.text();
  const sig = req.headers.get("x-line-signature");

  // Signature gate — reject anything not signed by our channel secret.
  if (!verifyLineSignature(rawBody, sig)) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  let body: LineWebhookBody;
  try {
    body = JSON.parse(rawBody) as LineWebhookBody;
  } catch {
    return NextResponse.json({});
  }

  const events = body.events ?? [];
  if (events.length > 0) {
    // Process after responding — LINE requires a prompt 200 ack.
    after(async () => {
      for (const ev of events) {
        try {
          await handleEvent(ev);
        } catch (err) {
          console.error("[LINE webhook] event error:", err);
        }
      }
    });
  }

  return NextResponse.json({});
}

// ---------------------------------------------------------------------------
// handleEvent — dispatch a group text message to the right command handler.
// ---------------------------------------------------------------------------

async function handleEvent(ev: LineEvent): Promise<void> {
  if (ev.type !== "message") return;
  if (ev.source?.type !== "group" || !ev.source.groupId) return;
  if (ev.message?.type !== "text" || !ev.message.text) return;

  const groupId = ev.source.groupId;
  const text = ev.message.text;

  // Bind takes precedence; anything else may be a self-link command (with or
  // without a bot @mention — parseSelfLinkCommand applies a stricter keyword
  // when the bot wasn't tagged). Mutually exclusive by content — a self-link
  // never matches BIND_RE.
  if (BIND_RE.test(text)) {
    await handleBind(ev, groupId, text);
    return;
  }
  await handleSelfLink(ev, groupId, text);
}

async function reply(ev: LineEvent, text: string): Promise<void> {
  if (ev.replyToken) await replyMessage(ev.replyToken, [{ type: "text", text }]);
}

// ---------------------------------------------------------------------------
// handleBind — bind the group to the club's SERIES when the bind command is
// posted (ADR 0002 P1 — decision #14: explicit conflict error both directions,
// never a silent rebind; decision #15 — the series owns the binding "once,
// forever", never a per-session row).
// ---------------------------------------------------------------------------

async function handleBind(ev: LineEvent, groupId: string, text: string): Promise<void> {
  const match = text.match(BIND_RE);
  if (!match) return;
  const token = match[1];

  const sb = await createAdminClient();
  // Site-admin-editable reply templates (blank/missing → code default).
  const { messages } = await getAppSettings();

  // 1. Resolve the target series — series-level join_token first, else the
  //    legacy per-session `clubs.join_token` lazily migrated onto a series
  //    (same (owner_id, name) rule as the backfill). activeClub is unused here —
  //    binding a group targets the series, not any one session.
  const entry = await resolveSeriesEntryByToken(sb, token);
  if (!entry) {
    await reply(ev, resolveBotMessage(messages, "bindInvalid"));
    return;
  }
  const { series } = entry;

  // Already bound to this same group (including the series just created above,
  // which starts unbound) → idempotent success.
  if (series.line_group_id === groupId) {
    await reply(ev, resolveBotMessage(messages, "bindSuccess", { club: series.name }));
    return;
  }

  // 2a. Conflict direction A — this LINE group is already bound to a DIFFERENT
  //     series (or still sits on a legacy clubs.line_group_id of a different
  //     series, pre-P1 data).
  const conflict = await findGroupBindingConflict(sb, groupId, series.id);
  if (conflict) {
    await reply(ev, resolveBotMessage(messages, "bindConflictGroup", { club: conflict.name }));
    return;
  }

  // 2b. Conflict direction B — the target series is already bound to a
  //     DIFFERENT group.
  if (series.line_group_id) {
    await reply(ev, resolveBotMessage(messages, "bindConflictSeries", { club: series.name }));
    return;
  }

  const { error } = await sb
    .from("club_series")
    .update({ line_group_id: groupId })
    .eq("id", series.id);

  if (error) {
    // Most likely uniq_club_series_line_group_id caught a race with a concurrent
    // bind — report the same explicit conflict rather than a bare failure.
    console.error("[LINE webhook] bind update error:", error.message);
    await reply(ev, resolveBotMessage(messages, "bindConflictGroup", { club: series.name }));
    return;
  }

  await reply(ev, resolveBotMessage(messages, "bindSuccess", { club: series.name }));
}

// ---------------------------------------------------------------------------
// handleSelfLink — a player types "เชื่อมไลน์ <ชื่อ>" (bot tag optional since
// 2026-07-16) to link their own LINE account. Parses/classifies via the pure
// helpers, then replies.
// ---------------------------------------------------------------------------

async function handleSelfLink(ev: LineEvent, groupId: string, text: string): Promise<void> {
  const mentionees = ev.message?.mention?.mentionees;
  const mentionedSelf = mentionees?.some((m) => m.isSelf === true) ?? false;

  const parsed = parseSelfLinkCommand(text, mentionedSelf, mentionees);
  if (!parsed) return; // no link keyword — ordinary chat, ignore silently

  // Site-admin-editable reply templates. Fetched only AFTER the addressed-bot
  // guard above, so ordinary group chatter never triggers a settings read.
  const { messages } = await getAppSettings();

  if (parsed.kind === "usage") {
    await reply(ev, resolveBotMessage(messages, "selfLinkUsage"));
    return;
  }

  // Group message events only carry source.userId for LINE iOS/Android users who
  // allow it; without it we can't identify the sender.
  const userId = ev.source?.userId;
  if (!userId) {
    await reply(ev, resolveBotMessage(messages, "selfLinkNoUser"));
    return;
  }

  const outcome = await resolveSelfLink({ groupId, userId, rosterName: parsed.rosterName });
  switch (outcome.kind) {
    case "no_club":
      await reply(ev, resolveBotMessage(messages, "selfLinkNoClub"));
      break;
    case "profile_failed":
      await reply(ev, resolveBotMessage(messages, "selfLinkProfileFailed"));
      break;
    case "linked":
      await reply(ev, resolveBotMessage(messages, "selfLinkLinked", { player: outcome.playerName }));
      break;
    case "already_linked":
      await reply(ev, resolveBotMessage(messages, "selfLinkAlready", { player: outcome.playerName }));
      break;
    case "pooled":
      await reply(ev, resolveBotMessage(messages, "selfLinkPooled"));
      break;
  }
}

type SelfLinkOutcome =
  | { kind: "linked"; playerName: string }
  | { kind: "already_linked"; playerName: string }
  | { kind: "pooled" }
  | { kind: "no_club" }
  | { kind: "profile_failed" };

/**
 * DB orchestration for a self-link command. Reconcile strategy locked in research
 * #50: upsert the profile by the Messaging-webhook userId (the id group @mentions
 * resolve against), auto-link ONLY a still-guest target (never overwrite), and let
 * the DB's unique guards + the pool absorb every non-clean case.
 *
 * Series-first (grilled 2026-07-16, supersedes the roster-only P1 shape): the
 * group resolves to a SERIES (`club_series.line_group_id`, legacy fallback) and
 * the typed name is classified against the UNION of the member registry
 * (primary — works with zero รอบตี) and the active session's roster
 * (supplementary) — see `classifyLinkTarget`. A member hit links the registry
 * row (+ the seeded roster row when one exists); a roster-only hit keeps the P1
 * path (upsert member, then attach). Non-clean cases pool as before — now with
 * `club_id: null` when the series has no session (migration 20260716000200).
 */
async function resolveSelfLink(args: {
  groupId: string;
  userId: string;
  rosterName: string;
}): Promise<SelfLinkOutcome> {
  const { groupId, userId, rosterName } = args;
  const sb = await createAdminClient();

  // 1. Which series owns this group — a bound series with NO session is fine
  //    now (the registry is the target); only a truly unbound group is no_club.
  const entry = await resolveSeriesEntryByGroupId(sb, groupId);
  if (!entry) return { kind: "no_club" };
  const { series, activeClub: club } = entry;

  // 2. Name the sender — group-member endpoint needs no friend/consent.
  const member = await getGroupMemberProfile(groupId, userId);
  if (!member) return { kind: "profile_failed" };

  // 3. Upsert the profiles row keyed by the Messaging userId. Same-provider ⇒ this
  //    dedups with any existing Login-created row via the unique line_user_id.
  const profile = await upsertLineProfile({
    userId,
    displayName: member.displayName,
    pictureUrl: member.pictureUrl ?? null,
  });
  if (!profile) return { kind: "profile_failed" };

  // 4. Both identity surfaces in one wave: the member registry (primary) and the
  //    active session's roster (supplementary; absent when the series has no รอบตี).
  const [membersRes, rosterRes] = await Promise.all([
    sb.from("series_members").select("id, canonical_name, profile_id").eq("series_id", series.id),
    club
      ? sb.from("club_players").select("id, display_name, profile_id, level_id, member_id").eq("club_id", club.id)
      : Promise.resolve({ data: null }),
  ]);
  const registry = (membersRes.data ?? []) as MemberCandidate[];
  const roster = (rosterRes.data ?? []) as (RosterLinkCandidate & { level_id: string | null })[];

  // 5. Idempotency across BOTH surfaces: linked in the current roster, or already
  //    a linked member of the series (the sessionless case).
  const existingRow = roster.find((r) => r.profile_id === profile.id);
  if (existingRow) return { kind: "already_linked", playerName: existingRow.display_name };
  const existingMember = registry.find((m) => m.profile_id === profile.id);
  if (existingMember) return { kind: "already_linked", playerName: existingMember.canonical_name };

  const match = classifyLinkTarget(registry, roster, rosterName);

  // 6a. Member hit (primary surface) → upgrade the registry row in place, then
  //     link the seeded roster row too when one is attached. Race guards mirror
  //     the roster path: `.is("profile_id", null)` + partial UNIQUE indexes.
  if (match.kind === "member") {
    const { data: upgraded, error: memberErr } = await sb
      .from("series_members")
      .update({ profile_id: profile.id, last_linked_at: new Date().toISOString() })
      .eq("id", match.memberId)
      .eq("series_id", series.id)
      .is("profile_id", null)
      .select("id, canonical_name")
      .maybeSingle();

    if (!memberErr && upgraded) {
      let playerName = upgraded.canonical_name as string;
      if (match.rosterPlayerId && club) {
        const { data: linkedRow } = await sb
          .from("club_players")
          .update({ profile_id: profile.id, member_id: match.memberId })
          .eq("id", match.rosterPlayerId)
          .eq("club_id", club.id)
          .is("profile_id", null)
          .select("display_name")
          .maybeSingle();
        if (linkedRow) playerName = linkedRow.display_name as string;
        // A lost race here is fine — the registry link (the durable one) succeeded.
      }
      // club_audit_logs is keyed by club_id (NOT NULL) — with no session there is
      // no audit surface for this event; the registry row itself records the link.
      if (club) {
        await sb.from("club_audit_logs").insert({
          club_id: club.id,
          actor_id: profile.id,
          actor_name: member.displayName,
          event_type: "player_linked_keyword",
          detail: `${playerName} ← ${profile.id} (keyword, member)`,
        });
      }
      return { kind: "linked", playerName };
    }
    // Lost the member-upgrade race → fall through to the pool.
    if (memberErr) console.error("[LINE webhook] self-link member update error:", memberErr.message);
  }

  // 6b. Roster-only hit (guest not in the registry) — the P1 path: upsert the
  //     member FIRST (decision #4/#11) so ONE club_players write carries
  //     profile_id + member_id.
  if (match.kind === "roster" && club) {
    const candidate = roster.find((r) => r.id === match.playerId);
    if (candidate) {
      const memberId = await upsertSeriesMember(sb, {
        seriesId: series.id,
        profileId: profile.id,
        name: candidate.display_name,
        levelId: candidate.level_id,
      });

      const { data: updated, error } = await sb
        .from("club_players")
        .update({ profile_id: profile.id, member_id: memberId })
        .eq("id", match.playerId)
        .eq("club_id", club.id)
        .is("profile_id", null) // race guard: only claim if still a guest row
        .select("id, display_name")
        .maybeSingle();

      if (!error && updated) {
        await sb.from("club_audit_logs").insert({
          club_id: club.id,
          actor_id: profile.id,
          actor_name: member.displayName,
          event_type: "player_linked_keyword",
          detail: `${updated.display_name} ← ${profile.id} (keyword)`,
        });
        // Confirmation is the in-group reply (see handleSelfLink). No 1:1 push — a
        // group member need not be a bot friend, so a DM would 403 for exactly the
        // users this flow targets, and the group reply already confirms.
        return { kind: "linked", playerName: updated.display_name };
      }
      // 23505 = this profile already links another row in the club (race the step-5
      // check missed); 0 rows = the guest row was claimed concurrently. Either way,
      // fall through to the pool instead of erroring.
      if (error) console.error("[LINE webhook] self-link update error:", error.message);
    }
  }

  // 7. Ambiguous / taken / not-found / lost-the-race → drop a pending pool request
  //    so a manager finishes it. Series-level idempotency FIRST (mirrors
  //    requestClubLinkAction): the active session pointer may have moved since an
  //    earlier request. With a session, keep the legacy upsert (insert-when-absent
  //    on UNIQUE(club_id, profile_id) — never resurrects a dismissed request);
  //    without one, poolSessionlessRequest insert-or-REVIVES the club-less row
  //    (a dismissed request must not become a silent permanent dead-end when the
  //    series has no session to absorb a fresh row).
  if (!(await hasPendingSeriesRequest(sb, series.id, profile.id))) {
    if (club) {
      await sb
        .from("club_link_requests")
        .upsert(
          { club_id: club.id, series_id: series.id, profile_id: profile.id, status: "pending" },
          { onConflict: "club_id,profile_id", ignoreDuplicates: true },
        );
    } else {
      await poolSessionlessRequest(sb, series.id, profile.id, "LINE webhook self-link");
    }
  }
  if (club) {
    await sb.from("club_audit_logs").insert({
      club_id: club.id,
      actor_id: profile.id,
      actor_name: member.displayName,
      event_type: "link_requested_keyword",
      detail: `${rosterName} → pool (keyword)`,
    });
  }
  return { kind: "pooled" };
}
