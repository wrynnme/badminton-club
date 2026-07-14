/**
 * src/app/api/line/webhook/route.ts
 *
 * Inbound LINE Messaging API webhook — signature-verified.
 *
 * Two inbound text commands, both in a group:
 *
 *   1. Bind (manager)      ผูกก๊วน <join_token>
 *      Captures `source.groupId` (LINE exposes a groupId only through webhook
 *      events — there is no group-list API) and stores it on `clubs.line_group_id`.
 *
 *   2. Self-link (player)  @<bot> เชื่อมไลน์ <ชื่อในโพย>
 *      A player @mentions the bot and types their roster name to link their LINE
 *      account themselves — a fast-path alongside the manager-confirmed pool. A
 *      clean unique guest-name match auto-links; anything else drops into the pool.
 *      Matching/parsing logic lives in `@/lib/club/line-self-link` (pure, tested);
 *      the DB orchestration is `resolveSelfLink` below.
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
  type RosterCandidate,
} from "@/lib/club/line-self-link";
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

  // Bind (no @mention) takes precedence; otherwise a bot @mention may be a
  // self-link command. The two are mutually exclusive by content — a self-link
  // starts with the "@bot" mention text, so it never matches BIND_RE.
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
// handleBind — bind the group to a club when the bind command is posted.
// ---------------------------------------------------------------------------

async function handleBind(ev: LineEvent, groupId: string, text: string): Promise<void> {
  const match = text.match(BIND_RE);
  if (!match) return;
  const token = match[1];

  const sb = await createAdminClient();
  // Site-admin-editable reply templates (blank/missing → code default).
  const { messages } = await getAppSettings();

  const { data: club } = await sb
    .from("clubs")
    .select("id, name, line_group_id")
    .eq("join_token", token)
    .maybeSingle();

  if (!club) {
    await reply(ev, resolveBotMessage(messages, "bindInvalid"));
    return;
  }

  // Already bound to this same group → idempotent success.
  if (club.line_group_id !== groupId) {
    const { error } = await sb
      .from("clubs")
      .update({ line_group_id: groupId })
      .eq("id", club.id);

    if (error) {
      // Most likely the group is already bound to a different club (unique index).
      console.error("[LINE webhook] bind update error:", error.message);
      await reply(ev, resolveBotMessage(messages, "bindConflict"));
      return;
    }
  }

  await reply(ev, resolveBotMessage(messages, "bindSuccess", { club: club.name }));
}

// ---------------------------------------------------------------------------
// handleSelfLink — a player @mentions the bot + types their roster name to link
// their own LINE account. Parses/classifies via the pure helpers, then replies.
// ---------------------------------------------------------------------------

async function handleSelfLink(ev: LineEvent, groupId: string, text: string): Promise<void> {
  const mentionees = ev.message?.mention?.mentionees;
  const mentionedSelf = mentionees?.some((m) => m.isSelf === true) ?? false;

  const parsed = parseSelfLinkCommand(text, mentionedSelf, mentionees);
  if (!parsed) return; // bot not addressed, or no keyword — ignore silently

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
 */
async function resolveSelfLink(args: {
  groupId: string;
  userId: string;
  rosterName: string;
}): Promise<SelfLinkOutcome> {
  const { groupId, userId, rosterName } = args;
  const sb = await createAdminClient();

  // 1. Which club owns this group?
  const { data: club } = await sb
    .from("clubs")
    .select("id, name")
    .eq("line_group_id", groupId)
    .maybeSingle();
  if (!club) return { kind: "no_club" };

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

  // 4. Idempotency: already linked to a row in this club?
  const { data: existing } = await sb
    .from("club_players")
    .select("id, display_name")
    .eq("club_id", club.id)
    .eq("profile_id", profile.id)
    .maybeSingle();
  if (existing) return { kind: "already_linked", playerName: existing.display_name };

  // 5. Classify the typed name against the roster.
  const { data: rows } = await sb
    .from("club_players")
    .select("id, display_name, profile_id")
    .eq("club_id", club.id);
  const match = classifyRosterMatch((rows ?? []) as RosterCandidate[], rosterName);

  // 6. Clean unique guest match → auto-link. `.is("profile_id", null)` + the partial
  //    UNIQUE uniq_club_players_profile make this race-safe and non-destructive.
  if (match.kind === "unique") {
    const { data: updated, error } = await sb
      .from("club_players")
      .update({ profile_id: profile.id })
      .eq("id", match.playerId)
      .eq("club_id", club.id)
      .is("profile_id", null)
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

  // 7. Ambiguous / taken / not-found / lost-the-race → drop a pending pool request
  //    so a manager finishes it. ignoreDuplicates = insert-when-absent only: never
  //    resurrect a request a manager already dismissed (rejected) back to pending;
  //    an existing pending row is left as-is.
  await sb
    .from("club_link_requests")
    .upsert(
      { club_id: club.id, profile_id: profile.id, status: "pending" },
      { onConflict: "club_id,profile_id", ignoreDuplicates: true },
    );
  await sb.from("club_audit_logs").insert({
    club_id: club.id,
    actor_id: profile.id,
    actor_name: member.displayName,
    event_type: "link_requested_keyword",
    detail: `${rosterName} → pool (keyword)`,
  });
  return { kind: "pooled" };
}
