/**
 * line-club.ts — generic LINE Messaging API helpers for club billing flows.
 *
 * These are plain server-side helpers (not "use server" server actions).
 * Import them from server actions or API route handlers only.
 *
 * Design mirrors line.ts:
 *   - env-guard at the top of every function (return false / null if token absent)
 *   - fetch to LINE endpoints with Authorization: Bearer <token>
 *   - console.error on non-OK responses, never throw
 *   - try/catch around every network call
 *
 * Required env vars:
 *   LINE_MESSAGING_CHANNEL_ACCESS_TOKEN — Messaging API channel access token
 *   LINE_MESSAGING_CHANNEL_SECRET       — Messaging API channel secret (for webhook sig verification)
 */

import { createHmac, timingSafeEqual } from "crypto";

const PUSH_ENDPOINT = "https://api.line.me/v2/bot/message/push";
const REPLY_ENDPOINT = "https://api.line.me/v2/bot/message/reply";

// ---------------------------------------------------------------------------
// pushTextToUser
// ---------------------------------------------------------------------------

/**
 * Push a plain-text message to a single LINE user.
 * Returns true on success, false on missing token or API error.
 */
export async function pushTextToUser(
  lineUserId: string,
  text: string,
): Promise<boolean> {
  const token = process.env.LINE_MESSAGING_CHANNEL_ACCESS_TOKEN;
  if (!token) return false;

  try {
    const res = await fetch(PUSH_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        to: lineUserId,
        messages: [{ type: "text", text }],
      }),
    });

    if (!res.ok) {
      const errBody = await res.text();
      console.error("[LINE-CLUB] pushTextToUser API error:", res.status, errBody);
      return false;
    }

    return true;
  } catch (err) {
    console.error("[LINE-CLUB] pushTextToUser exception:", err);
    return false;
  }
}

// ---------------------------------------------------------------------------
// pushFlexToUser
// ---------------------------------------------------------------------------

/**
 * Push a Flex Message bubble to a single LINE user.
 * `contents` is an arbitrary Flex bubble object built by the caller.
 * Returns true on success, false on missing token or API error.
 */
export async function pushFlexToUser(
  lineUserId: string,
  altText: string,
  contents: unknown,
): Promise<boolean> {
  const token = process.env.LINE_MESSAGING_CHANNEL_ACCESS_TOKEN;
  if (!token) return false;

  try {
    const res = await fetch(PUSH_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        to: lineUserId,
        messages: [{ type: "flex", altText, contents }],
      }),
    });

    if (!res.ok) {
      const errBody = await res.text();
      console.error("[LINE-CLUB] pushFlexToUser API error:", res.status, errBody);
      return false;
    }

    return true;
  } catch (err) {
    console.error("[LINE-CLUB] pushFlexToUser exception:", err);
    return false;
  }
}

// ---------------------------------------------------------------------------
// replyMessage
// ---------------------------------------------------------------------------

/**
 * Reply to a webhook event using the one-time replyToken.
 * `messages` is an array of LINE message objects (text, flex, image, etc.).
 * Returns true on success, false on missing token or API error.
 */
export async function replyMessage(
  replyToken: string,
  messages: unknown[],
): Promise<boolean> {
  const token = process.env.LINE_MESSAGING_CHANNEL_ACCESS_TOKEN;
  if (!token) return false;

  try {
    const res = await fetch(REPLY_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ replyToken, messages }),
    });

    if (!res.ok) {
      const errBody = await res.text();
      console.error("[LINE-CLUB] replyMessage API error:", res.status, errBody);
      return false;
    }

    return true;
  } catch (err) {
    console.error("[LINE-CLUB] replyMessage exception:", err);
    return false;
  }
}

// ---------------------------------------------------------------------------
// verifyLineSignature
// ---------------------------------------------------------------------------

/**
 * Verify a LINE webhook request signature.
 *
 * LINE computes: base64( HMAC-SHA256(rawBody, channelSecret) )
 * and sends it in the `x-line-signature` header.
 *
 * Uses `crypto.timingSafeEqual` to prevent timing-oracle attacks.
 * Returns false if:
 *   - LINE_MESSAGING_CHANNEL_SECRET is not set
 *   - `signature` is null / missing
 *   - digests do not match
 */
export function verifyLineSignature(
  rawBody: string,
  signature: string | null,
): boolean {
  const secret = process.env.LINE_MESSAGING_CHANNEL_SECRET;
  if (!secret || !signature) return false;

  const expected = createHmac("sha256", secret)
    .update(rawBody)
    .digest("base64");

  // timingSafeEqual requires equal-length Buffers.
  const expectedBuf = Buffer.from(expected);
  const actualBuf = Buffer.from(signature);
  if (expectedBuf.length !== actualBuf.length) return false;

  return timingSafeEqual(expectedBuf, actualBuf);
}
