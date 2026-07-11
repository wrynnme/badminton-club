/**
 * group-billing.ts — pure helpers for collecting money inside a LINE **group**.
 *
 * Unlike the 1:1 flow (`pushClubBillsAction`, one Flex bill per user), the group
 * flow posts into the club's bound LINE group, bucketed **by amount owed**: every
 * player who owes the same total is tagged (@mention) in ONE message alongside a
 * single PromptPay QR for that amount.
 *
 *   170 บาท → @bee @pang   + QR(170)
 *    90 บาท → @bank @boy   + QR(90)
 *
 * ── LINE API constraint that shapes this module ────────────────────────────
 * A single LINE message bubble cannot carry BOTH a real @mention AND an image:
 *   • text messages support `mention.mentionees[]` but no image;
 *   • image / Flex messages support an image but NOT mentions.
 * So each amount is delivered as a single push whose `messages` array is
 * `[ textMessage(with mentionees), imageMessage(QR) ]` — two bubbles that arrive
 * together. See buildGroupBillMessages.
 *
 * `mention.mentionees[].index` / `.length` are counted in UTF-16 code units,
 * which is exactly what JS `String.prototype.length` returns — so offsets are
 * computed by building the text string and reading `.length` as we go. LINE caps
 * a message at 20 mentionees; buckets larger than that are split across messages.
 *
 * Everything here is pure (no I/O). QR generation/upload + the actual push live
 * in the server action; this module only decides *what* to send.
 */

// --- LINE message object shapes (minimal subset we emit) --------------------

export type LineMentionee = {
  index: number;
  length: number;
  type: "user";
  userId: string;
};

export type LineTextMessage = {
  type: "text";
  text: string;
  mention?: { mentionees: LineMentionee[] };
};

export type LineImageMessage = {
  type: "image";
  originalContentUrl: string;
  previewImageUrl: string;
};

export type LineMessage = LineTextMessage | LineImageMessage;

// --- Domain shapes ----------------------------------------------------------

/** One payable player as seen by the group-billing flow. */
export type GroupBillPlayer = {
  playerId: string;
  displayName: string;
  /** Resolved LINE userId (profile_id → profiles.line_user_id), or null. */
  lineUserId: string | null;
  /** Total owed, in baht. */
  amount: number;
};

/** Players sharing one amount, split into reachable (mentionable) vs not. */
export type GroupBillBucket = {
  amount: number;
  /** Players with a LINE userId — these get a real @mention + notification. */
  members: { playerId: string; displayName: string; lineUserId: string }[];
  /** Players who owe this amount but have no linked LINE account (can't tag). */
  unreachable: { playerId: string; displayName: string }[];
};

/** LINE hard limit: max 20 mentionees per message. */
export const MAX_MENTIONS_PER_MESSAGE = 20;
/** LINE hard limit: max 5 message objects per push request. */
export const MAX_MESSAGES_PER_PUSH = 5;

// ---------------------------------------------------------------------------
// bucketBillsByAmount
// ---------------------------------------------------------------------------

/**
 * Group payable players by the exact amount they owe.
 *
 * - Players with `amount <= 0` are dropped (nothing to collect).
 * - Within a bucket, players with a `lineUserId` go to `members` (mentionable);
 *   those without go to `unreachable` (owe money but can't be tagged).
 * - Buckets are returned highest-amount-first (so 170 lists before 90).
 * - Member/unreachable order within a bucket preserves input order (callers pass
 *   players already ordered by roster position).
 */
export function bucketBillsByAmount(
  players: GroupBillPlayer[],
): GroupBillBucket[] {
  const byAmount = new Map<number, GroupBillBucket>();

  for (const p of players) {
    if (!(p.amount > 0)) continue;

    let bucket = byAmount.get(p.amount);
    if (!bucket) {
      bucket = { amount: p.amount, members: [], unreachable: [] };
      byAmount.set(p.amount, bucket);
    }

    if (p.lineUserId) {
      bucket.members.push({
        playerId: p.playerId,
        displayName: p.displayName,
        lineUserId: p.lineUserId,
      });
    } else {
      bucket.unreachable.push({
        playerId: p.playerId,
        displayName: p.displayName,
      });
    }
  }

  return [...byAmount.values()].sort((a, b) => b.amount - a.amount);
}

// ---------------------------------------------------------------------------
// buildGroupBillText
// ---------------------------------------------------------------------------

/**
 * Build ONE mention-carrying text message for up to 20 members of a bucket.
 *
 * Layout (mentions FIRST so their offsets start at 0 — no preceding emoji /
 * surrogate pair can shift the index):
 *
 *     @bee @pang
 *     ค่าก๊วน<clubName> <dateStr> · 170 บาท
 *     สแกน QR ด้านล่างจ่ายได้เลย 🙏
 *
 * `members` MUST already be sliced to ≤ 20 (see buildGroupBillMessages).
 */
export function buildGroupBillText(params: {
  clubName: string;
  amount: number;
  members: { displayName: string; lineUserId: string }[];
  dateStr?: string;
}): LineTextMessage {
  const { clubName, amount, members, dateStr } = params;

  const mentionees: LineMentionee[] = [];
  let text = "";

  members.forEach((m, i) => {
    if (i > 0) text += " ";
    const tag = `@${m.displayName}`;
    // index/length in UTF-16 units === JS string .length at this point.
    mentionees.push({
      index: text.length,
      length: tag.length,
      type: "user",
      userId: m.lineUserId,
    });
    text += tag;
  });

  text += `\nค่าก๊วน${clubName}${dateStr ? ` ${dateStr}` : ""} · ${amount.toLocaleString(
    "en-US",
  )} บาท`;
  text += `\nสแกน QR ด้านล่างจ่ายได้เลย 🙏`;

  const msg: LineTextMessage = { type: "text", text };
  if (mentionees.length > 0) msg.mention = { mentionees };
  return msg;
}

// ---------------------------------------------------------------------------
// buildQrImageMessage
// ---------------------------------------------------------------------------

/** Wrap an already-hosted QR PNG URL as a LINE image message. */
export function buildQrImageMessage(qrUrl: string): LineImageMessage {
  return {
    type: "image",
    originalContentUrl: qrUrl,
    previewImageUrl: qrUrl,
  };
}

// ---------------------------------------------------------------------------
// buildGroupBillMessages
// ---------------------------------------------------------------------------

/**
 * Build the full `messages[]` for ONE amount bucket, ready to hand to a LINE
 * push whose `to` is the group id.
 *
 * - Members are chunked by 20 (LINE mentionee cap): each chunk → one text
 *   message. In the overwhelmingly common case that's a single text bubble.
 * - The QR image (when `qrUrl` given) is appended as the last bubble so it sits
 *   directly under the tags.
 * - The result is clamped to LINE's 5-messages-per-push limit; `overflow` is set
 *   true when clamping actually dropped a trailing text chunk so the caller can
 *   fall back (e.g. send remaining chunks in a second push).
 */
export function buildGroupBillMessages(
  bucket: GroupBillBucket,
  opts: { clubName: string; qrUrl: string | null; dateStr?: string },
): { messages: LineMessage[]; overflow: boolean } {
  const chunks: { displayName: string; lineUserId: string }[][] = [];
  for (let i = 0; i < bucket.members.length; i += MAX_MENTIONS_PER_MESSAGE) {
    chunks.push(bucket.members.slice(i, i + MAX_MENTIONS_PER_MESSAGE));
  }
  // A bucket may have only unreachable players — still announce the amount once.
  if (chunks.length === 0) chunks.push([]);

  const textMessages: LineMessage[] = chunks.map((members) =>
    buildGroupBillText({
      clubName: opts.clubName,
      amount: bucket.amount,
      members,
      dateStr: opts.dateStr,
    }),
  );

  const imageMessages: LineMessage[] = opts.qrUrl
    ? [buildQrImageMessage(opts.qrUrl)]
    : [];

  const all = [...textMessages, ...imageMessages];
  const messages = all.slice(0, MAX_MESSAGES_PER_PUSH);
  return { messages, overflow: all.length > messages.length };
}
