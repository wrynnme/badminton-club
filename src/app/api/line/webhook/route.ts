/**
 * src/app/api/line/webhook/route.ts
 *
 * Inbound LINE Messaging API webhook — signature-verified health ack.
 *
 * The club slip-verification feature was removed, so there is no inbound
 * message processing left. The endpoint is kept (signature-verified 200 ack)
 * so the LINE console "Verify" check passes, LINE stops retrying, and a future
 * inbound feature can be added without reconfiguring the channel webhook URL.
 *
 * Security: HMAC-SHA256 signature verified against LINE_MESSAGING_CHANNEL_SECRET
 * before responding.
 *
 * Required env vars:
 *   LINE_MESSAGING_CHANNEL_SECRET  — webhook signature verification
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyLineSignature } from "@/lib/notification/line-club";

// ---------------------------------------------------------------------------
// GET — health check (harmless, helps confirm deployment)
// ---------------------------------------------------------------------------

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ ok: true });
}

// ---------------------------------------------------------------------------
// POST — LINE webhook handler: verify signature, then ack. Events are ignored.
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest): Promise<NextResponse> {
  // Read raw body FIRST — LINE signs the raw bytes.
  const rawBody = await req.text();
  const sig = req.headers.get("x-line-signature");

  // Signature gate — reject anything not signed by our channel secret.
  if (!verifyLineSignature(rawBody, sig)) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  // No inbound processing remains — respond 200 so LINE is satisfied.
  return NextResponse.json({});
}
