/**
 * src/app/api/line/webhook/route.ts
 *
 * Inbound LINE Messaging API webhook — signature-verified.
 *
 * Scope is deliberately minimal: the only inbound behaviour is **binding a LINE
 * group to a club** for group billing. A manager posts the bind command plus the
 * club's join_token in the group:
 *
 *     ผูกก๊วน <join_token>
 *
 * and this handler captures `source.groupId` (LINE exposes a groupId only through
 * webhook events — there is no group-list API) and stores it on
 * `clubs.line_group_id`. No slip/image processing exists (that feature was removed
 * in v0.22.0); this is not a revival of it.
 *
 * Security: HMAC-SHA256 signature verified against LINE_MESSAGING_CHANNEL_SECRET
 * before anything else. Heavy work runs in `after()` so LINE gets a fast 200 ack.
 *
 * Required env vars:
 *   LINE_MESSAGING_CHANNEL_SECRET        — webhook signature verification
 *   LINE_MESSAGING_CHANNEL_ACCESS_TOKEN  — reply confirmation to the group
 */

import { NextRequest, NextResponse, after } from "next/server";
import { verifyLineSignature, replyMessage } from "@/lib/notification/line-club";
import { createAdminClient } from "@/lib/supabase/server";

// Manager posts "ผูกก๊วน <join_token>" in the group to bind it.
const BIND_RE = /^\s*ผูกก๊วน\s+(\S+)\s*$/;

type LineSource = { type?: string; groupId?: string; userId?: string };
type LineEvent = {
  type?: string;
  replyToken?: string;
  source?: LineSource;
  message?: { type?: string; text?: string };
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
          await handleBindEvent(ev);
        } catch (err) {
          console.error("[LINE webhook] event error:", err);
        }
      }
    });
  }

  return NextResponse.json({});
}

// ---------------------------------------------------------------------------
// handleBindEvent — bind the group to a club when the bind command is posted.
// ---------------------------------------------------------------------------

async function handleBindEvent(ev: LineEvent): Promise<void> {
  if (ev.type !== "message") return;
  if (ev.source?.type !== "group" || !ev.source.groupId) return;
  if (ev.message?.type !== "text" || !ev.message.text) return;

  const match = ev.message.text.match(BIND_RE);
  if (!match) return;

  const token = match[1];
  const groupId = ev.source.groupId;

  const sb = await createAdminClient();

  const { data: club } = await sb
    .from("clubs")
    .select("id, name, line_group_id")
    .eq("join_token", token)
    .maybeSingle();

  if (!club) {
    if (ev.replyToken) {
      await replyMessage(ev.replyToken, [
        { type: "text", text: "❌ โค้ดผูกก๊วนไม่ถูกต้อง" },
      ]);
    }
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
      if (ev.replyToken) {
        await replyMessage(ev.replyToken, [
          {
            type: "text",
            text: "❌ ผูกกลุ่มไม่สำเร็จ — กลุ่มนี้อาจถูกผูกกับก๊วนอื่นอยู่แล้ว",
          },
        ]);
      }
      return;
    }
  }

  if (ev.replyToken) {
    await replyMessage(ev.replyToken, [
      {
        type: "text",
        text: `✅ ผูกกลุ่มนี้กับก๊วน "${club.name}" แล้ว — ต่อไปเรียกเก็บเงินในกลุ่มนี้ได้เลย`,
      },
    ]);
  }
}
