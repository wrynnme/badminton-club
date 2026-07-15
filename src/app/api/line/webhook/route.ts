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
 *      A player types their roster name after the keyword to link their LINE
 *      account themselves — a fast-path alongside the manager-confirmed pool. A
 *      clean unique guest-name match auto-links; anything else drops into the pool.
 *      Matching/parsing logic lives in `@/lib/club/line-self-link` (pure, tested);
 *      the DB orchestration is `resolveSelfLink` below. Every successful link also
 *      writes through to `series_members` (decision #4/#11).
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
import {
  parseSelfLinkCommand,
  classifyRosterMatch,
  type Mentionee,
} from "@/lib/club/line-self-link";
import {
  findGroupBindingConflict,
  hasPendingSeriesRequest,
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
 * resolve against), auto-link ONLY a still-guest row (never overwrite), and let the
 * DB's uniq_club_players_profile guard + the pool absorb every non-clean case.
 *
 * ADR 0002 P1: the group resolves to a SERIES first (`club_series.line_group_id`),
 * falling back to a legacy `clubs.line_group_id` match that gets lazily migrated
 * onto a series; the roster acted on is always the series' active session
 * (decision #3), falling back to the legacy-matched club when the series has no
 * active pointer yet. Every successful link also writes through to
 * `series_members` (decision #4/#11) and stamps the roster row's `member_id`.
 */
async function resolveSelfLink(args: {
  groupId: string;
  userId: string;
  rosterName: string;
}): Promise<SelfLinkOutcome> {
  const { groupId, userId, rosterName } = args;
  const sb = await createAdminClient();

  // 1/2. Which series owns this group + its target roster (the series' active
  //      session, decision #3; falls back to a legacy-matched club when the
  //      series has no active pointer yet) — see resolveSeriesEntryByGroupId.
  const entry = await resolveSeriesEntryByGroupId(sb, groupId);
  if (!entry || !entry.activeClub) return { kind: "no_club" };
  const { series, activeClub: club } = entry;

  // 3. Name the sender — group-member endpoint needs no friend/consent.
  const member = await getGroupMemberProfile(groupId, userId);
  if (!member) return { kind: "profile_failed" };

  // 4. Upsert the profiles row keyed by the Messaging userId. Same-provider ⇒ this
  //    dedups with any existing Login-created row via the unique line_user_id.
  const profile = await upsertLineProfile({
    userId,
    displayName: member.displayName,
    pictureUrl: member.pictureUrl ?? null,
  });
  if (!profile) return { kind: "profile_failed" };

  // 5/6. Fetch the roster ONCE — used both for the already-linked idempotency
  //      check and the roster-name classification (previously two separate
  //      queries over the same club_players set).
  const { data: rows } = await sb
    .from("club_players")
    .select("id, display_name, profile_id, level_id")
    .eq("club_id", club.id);
  const roster = rows ?? [];

  const existing = roster.find((r) => r.profile_id === profile.id);
  if (existing) return { kind: "already_linked", playerName: existing.display_name };

  const match = classifyRosterMatch(roster, rosterName);

  // 7. Clean unique guest match → auto-link. `.is("profile_id", null)` + the partial
  //    UNIQUE uniq_club_players_profile make this race-safe and non-destructive.
  if (match.kind === "unique") {
    const candidate = roster.find((r) => r.id === match.playerId);
    if (candidate) {
      // Upsert the member FIRST, mirroring linkClubPlayerAction/linkKnownProfileAction's
      // order (decision #4/#11), so ONE club_players write carries profile_id +
      // member_id instead of update→upsert→update.
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
      // 23505 = this profile already links another row in the club (race the step-4
      // check missed); 0 rows = the guest row was claimed concurrently. Either way,
      // fall through to the pool instead of erroring.
      if (error) console.error("[LINE webhook] self-link update error:", error.message);
    }
  }

  // 8. Ambiguous / taken / not-found / lost-the-race → drop a pending pool request
  //    so a manager finishes it (series-scoped — ADR 0002 P1). ignoreDuplicates =
  //    insert-when-absent only: never resurrect a request a manager already
  //    dismissed (rejected) back to pending; an existing pending row is left as-is.
  //    Series-level idempotency FIRST (mirrors requestClubLinkAction): the active
  //    session pointer may have moved since an earlier request, so the legacy
  //    (club_id, profile_id) conflict target alone would happily create a second
  //    pending row for the same profile in the same series.
  if (!(await hasPendingSeriesRequest(sb, series.id, profile.id))) {
    await sb
      .from("club_link_requests")
      .upsert(
        { club_id: club.id, series_id: series.id, profile_id: profile.id, status: "pending" },
        { onConflict: "club_id,profile_id", ignoreDuplicates: true },
      );
  }
  await sb.from("club_audit_logs").insert({
    club_id: club.id,
    actor_id: profile.id,
    actor_name: member.displayName,
    event_type: "link_requested_keyword",
    detail: `${rosterName} → pool (keyword)`,
  });
  return { kind: "pooled" };
}
