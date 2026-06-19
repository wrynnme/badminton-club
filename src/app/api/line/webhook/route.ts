/**
 * src/app/api/line/webhook/route.ts
 *
 * Inbound LINE Messaging API webhook — club auto-billing slip handler.
 *
 * Security: HMAC-SHA256 signature verified against LINE_MESSAGING_CHANNEL_SECRET
 * BEFORE any JSON parsing. All heavy work (DB, network) runs inside `after()`
 * so LINE receives a 200 within milliseconds.
 *
 * Required env vars:
 *   LINE_MESSAGING_CHANNEL_SECRET        — webhook signature verification
 *   LINE_MESSAGING_CHANNEL_ACCESS_TOKEN  — push API calls (used by helpers)
 *   NEXT_PUBLIC_SUPABASE_URL             — Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY            — service-role key (bypasses RLS)
 *
 * Slip verification is now per-club (no platform-level env vars):
 *   clubs.billing_verify_settings  — mode ("manual"|"byok") + provider + branch_id
 *   club_billing_secrets            — api_key (read separately, never joined into clubs.*)
 */

import { NextRequest, NextResponse, after } from "next/server";
import {
  verifyLineSignature,
  getMessageContent,
  pushTextToUser,
} from "@/lib/notification/line-club";
import { verifySlip, matchSlipToBill } from "@/lib/club/slip-verify";
import { parseBillingVerifySettings } from "@/lib/club/billing-verify-settings";
import { createAdminClient } from "@/lib/supabase/server";

// ---------------------------------------------------------------------------
// Types — narrow what we need from the LINE webhook payload
// ---------------------------------------------------------------------------

interface LineMessageEvent {
  type: "message";
  timestamp: number;
  source?: { userId?: string };
  message?: { id: string; type: string };
}

interface LineOtherEvent {
  type: string;
  timestamp?: number;
  source?: { userId?: string };
  message?: undefined;
}

type LineEvent = LineMessageEvent | LineOtherEvent;

interface LineWebhookBody {
  events?: LineEvent[];
}

// Supabase join typing: club_players row with embedded clubs relation.
// The Supabase JS client returns a related *-to-one row as a plain object
// (never an array) when the FK is named clubs(*). We model both shapes and
// normalise defensively.
interface ClubRow {
  id: string;
  name: string;
  promptpay_id: string | null;
  promptpay_name: string | null;
  billing_verify_settings: Record<string, unknown> | null;
}

interface CandidateBill {
  id: string;
  club_id: string;
  bill_amount: number | null;
  display_name: string | null;
  clubs: ClubRow | ClubRow[] | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Normalise the Supabase nested-join clubs relation to a single ClubRow. */
function resolveClub(clubs: ClubRow | ClubRow[] | null): ClubRow | null {
  if (!clubs) return null;
  if (Array.isArray(clubs)) return clubs[0] ?? null;
  return clubs;
}

// ---------------------------------------------------------------------------
// GET — health check (harmless, helps confirm deployment)
// ---------------------------------------------------------------------------

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ ok: true });
}

// ---------------------------------------------------------------------------
// POST — LINE webhook handler
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest): Promise<NextResponse> {
  // 1. Read raw body FIRST — LINE signs the raw bytes.
  const rawBody = await req.text();
  const sig = req.headers.get("x-line-signature");

  // 2. Signature gate — must run BEFORE any parsing.
  if (!verifyLineSignature(rawBody, sig)) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  // 3. Parse body — guard bad JSON.
  let body: LineWebhookBody;
  try {
    body = JSON.parse(rawBody) as LineWebhookBody;
  } catch {
    return new NextResponse("Bad Request", { status: 400 });
  }

  // 4. Schedule all heavy work after the 200 response.
  //    LINE requires a fast ack; `after()` runs post-flush.
  after(async () => {
    const events = body.events ?? [];

    // Only image-message events need processing; everything else (follow,
    // unfollow, LINE "Verify" button, postback, etc.) is silently ignored.
    const imageEvents = events.filter(
      (e): e is LineMessageEvent =>
        e.type === "message" && e.message?.type === "image",
    );

    // Initialise the Supabase admin client once per webhook call.
    const sb = await createAdminClient();

    for (const event of imageEvents) {
      try {
        const userId = event.source?.userId;
        const messageId = event.message?.id;

        if (!userId || !messageId) continue;

        // ----------------------------------------------------------------
        // A. Resolve LINE user → profile
        // ----------------------------------------------------------------
        const { data: profile } = await sb
          .from("profiles")
          .select("id")
          .eq("line_user_id", userId)
          .maybeSingle();

        if (!profile) {
          await pushTextToUser(
            userId,
            "ไม่พบบัญชีของคุณในระบบ กรุณาเข้าสู่ระบบด้วย LINE ในเว็บก่อน",
          );
          continue;
        }

        // ----------------------------------------------------------------
        // B. Find unpaid candidate bills for this profile
        //    (may span multiple clubs — ordered newest bill push first)
        // ----------------------------------------------------------------
        const { data: rawCandidates } = await sb
          .from("club_players")
          .select(
            "id, club_id, bill_amount, display_name, clubs(id, name, promptpay_id, promptpay_name, billing_verify_settings)",
          )
          .eq("profile_id", profile.id)
          .is("paid_at", null)
          .not("bill_pushed_at", "is", null)
          .order("bill_pushed_at", { ascending: false });

        const candidates = (rawCandidates ?? []) as CandidateBill[];

        if (candidates.length === 0) {
          await pushTextToUser(userId, "ไม่มีบิลค้างชำระในตอนนี้");
          continue;
        }

        // ----------------------------------------------------------------
        // C. Download slip image
        // ----------------------------------------------------------------
        const buf = await getMessageContent(messageId);
        if (!buf) {
          await pushTextToUser(
            userId,
            "อ่านรูปสลิปไม่สำเร็จ ลองส่งใหม่อีกครั้ง",
          );
          continue;
        }

        // ----------------------------------------------------------------
        // D. Fast-path: resolve target club from candidates[0]
        //    Parse its billing_verify_settings to determine verify mode.
        //    Multi-club loop is deferred to a future phase — for now we
        //    use the most-recent bill's club as the verification context.
        // ----------------------------------------------------------------
        const primaryClub = resolveClub(candidates[0].clubs);
        const verifySettings = parseBillingVerifySettings(
          primaryClub?.billing_verify_settings ?? null,
        );

        // ----------------------------------------------------------------
        // E. Verify slip (or skip when manual mode)
        // ----------------------------------------------------------------
        let detected: Awaited<ReturnType<typeof verifySlip>>;

        if (verifySettings.mode === "manual") {
          // Skip provider entirely — go straight to manual queue.
          detected = { ok: false, reason: "manual_mode" };
        } else {
          // byok: read the club's api_key from club_billing_secrets (never joined).
          const { data: secretRow } = await sb
            .from("club_billing_secrets")
            .select("api_key")
            .eq("club_id", candidates[0].club_id)
            .maybeSingle();

          const verifyConfig = {
            provider: verifySettings.provider,
            apiKey: secretRow?.api_key ?? null,
            branchId: verifySettings.branch_id,
          };

          detected = await verifySlip({ imageBuffer: buf }, verifyConfig);
        }

        // ----------------------------------------------------------------
        // F. Pick the target bill
        //    If verified + amount known → match by amount (±0.01 THB)
        //    within the same club as the primary candidate.
        //    Otherwise fall back to most-recent candidate.
        // ----------------------------------------------------------------
        let target: CandidateBill = candidates[0];

        if (detected.ok && detected.amount != null) {
          // Restrict amount-match search to the same club used for verification.
          const sameClubCandidates = candidates.filter(
            (c) => c.club_id === candidates[0].club_id,
          );
          const amountMatch = sameClubCandidates.find(
            (c) =>
              c.bill_amount != null &&
              Math.abs(Number(c.bill_amount) - detected.amount!) <= 0.01,
          );
          if (amountMatch) target = amountMatch;
        }

        const club = resolveClub(target.clubs);

        // ----------------------------------------------------------------
        // G. Upload slip image to private bucket
        //    Path: <club_id>/<club_player_id>/<timestamp>.png
        //    Keep path even if upload errors — still record the slip row.
        // ----------------------------------------------------------------
        const ts = event.timestamp
          ? event.timestamp
          : new Date().toISOString();
        const uploadPath = `${target.club_id}/${target.id}/${ts}.png`;

        const { error: uploadError } = await sb.storage
          .from("payment-slips")
          .upload(uploadPath, buf, {
            contentType: "image/jpeg",
            upsert: false,
          });

        if (uploadError) {
          console.error(
            "[LINE-WEBHOOK] slip upload error:",
            uploadError.message,
            "path:",
            uploadPath,
          );
          // Non-fatal — continue with the intended path recorded in DB.
        }

        // ----------------------------------------------------------------
        // H. Decide: auto-verify or queue for manual review
        // ----------------------------------------------------------------
        const decision = matchSlipToBill({
          detected,
          billAmount: Number(target.bill_amount ?? 0),
          clubPromptpayId: club?.promptpay_id ?? null,
          clubPromptpayName: club?.promptpay_name ?? null,
        });

        // ----------------------------------------------------------------
        // I. Insert slip record
        // ----------------------------------------------------------------
        const { error: slipError } = await sb.from("club_payment_slips").insert({
          club_id: target.club_id,
          club_player_id: target.id,
          image_path: uploadPath,
          amount_detected: detected.amount ?? null,
          sender_name: null,          // SlipVerifyResult has no senderName field
          receiver_name: detected.receiverName ?? null,
          trans_ref: detected.transRef ?? null,
          verify_status: decision.result,
          verify_raw: detected.raw ?? null,
        });

        if (slipError) {
          console.error("[LINE-WEBHOOK] slip insert error:", slipError.message);
        }

        // ----------------------------------------------------------------
        // J. Confirm payment or queue for review
        // ----------------------------------------------------------------
        if (decision.result === "verified") {
          // Guard: .is("paid_at", null) prevents double-confirm races.
          const { error: updateError } = await sb
            .from("club_players")
            .update({
              paid_at: new Date().toISOString(),
              paid_method: "promptpay_slip",
            })
            .eq("id", target.id)
            .is("paid_at", null);

          if (updateError) {
            console.error(
              "[LINE-WEBHOOK] paid_at update error:",
              updateError.message,
            );
          }

          const clubName = club?.name ?? "ก๊วน";
          const amount = Number(target.bill_amount).toLocaleString();
          await pushTextToUser(
            userId,
            `✅ ยืนยันการชำระแล้ว ฿${amount} — ${clubName}\nขอบคุณครับ 🙏`,
          );
        } else {
          await pushTextToUser(
            userId,
            "ได้รับสลิปแล้ว 🙏 กำลังรอเจ้าของก๊วนตรวจสอบยืนยัน",
          );
        }

        // ----------------------------------------------------------------
        // K. Audit log
        // ----------------------------------------------------------------
        const { error: auditError } = await sb.from("club_audit_logs").insert({
          club_id: target.club_id,
          actor_id: userId,
          actor_name: target.display_name ?? null,
          event_type:
            decision.result === "verified"
              ? "slip_auto_verified"
              : "slip_pending_review",
          detail: `mode ${verifySettings.mode}; reason ${decision.reason}; detected ${detected.amount ?? "-"} / bill ${target.bill_amount}`,
        });

        if (auditError) {
          console.error(
            "[LINE-WEBHOOK] audit insert error:",
            auditError.message,
          );
        }
      } catch (err) {
        // Per-event catch: one bad event must not prevent the rest.
        console.error("[LINE-WEBHOOK] event processing error:", err);
      }
    }
  });

  // Respond 200 immediately — LINE needs this before heavy work completes.
  return NextResponse.json({});
}
