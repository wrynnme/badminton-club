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
 * Sending a WORKING @mention requires **Text Message v2** (`type: "textV2"`) with
 * a `substitution` map: the text holds `{key}` placeholders and each key maps to a
 * `{type:"mention", mentionee:{type:"user", userId}}` entry. LINE renders each
 * placeholder as "@<that user's LINE display name>" and fires their notification.
 * (The older `text` + `mention.mentionees[]` index/length shape is the *inbound*
 * webhook format — on send LINE returns HTTP 200 but silently drops the mention,
 * so it renders as plain text with no notification. That mismatch was the bug.)
 *
 * A single bubble can't carry both a mention and an image, so each amount is one
 * push of `[ textV2(with mentions), imageMessage(QR) ]`. LINE caps a message at 20
 * mentionees; larger buckets are split across messages. See buildGroupBillMessages.
 *
 * Everything here is pure (no I/O). QR generation/upload + the actual push live
 * in the server action; this module only decides *what* to send.
 */

// --- LINE message object shapes (minimal subset we emit) --------------------

/**
 * A textV2 `substitution` entry that renders as an @mention of one user. LINE
 * fills in the user's current LINE display name automatically — we never send the
 * @name text ourselves.
 */
export type LineMentionSubstitution = {
  type: "mention";
  mentionee: { type: "user"; userId: string };
};

/**
 * Text Message v2 — the ONLY message type that can SEND a working @mention. The
 * text carries `{key}` placeholders; each key maps to a `substitution` entry.
 */
export type LineTextV2Message = {
  type: "textV2";
  text: string;
  substitution?: Record<string, LineMentionSubstitution>;
};

export type LineImageMessage = {
  type: "image";
  originalContentUrl: string;
  previewImageUrl: string;
};

export type LineMessage = LineTextV2Message | LineImageMessage;

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
 * Build ONE mention-carrying textV2 message for up to 20 members of a bucket.
 *
 * Placeholders lead the message; LINE substitutes each `{mN}` with the mentioned
 * user's current LINE display name (so we never send the @name text ourselves):
 *
 *     {m0} {m1}                          → renders as "@bee @pang"
 *     ค่าก๊วน<clubName> <dateStr> · 170 บาท
 *     สแกน QR ด้านล่างจ่ายได้เลย 🙏
 *
 * `members` MUST already be sliced to ≤ 20 (see buildGroupBillMessages). Member
 * `displayName` is intentionally unused — textV2 renders the live LINE name.
 */
export function buildGroupBillText(params: {
  clubName: string;
  amount: number;
  members: { displayName: string; lineUserId: string }[];
  dateStr?: string;
}): LineTextV2Message {
  const { clubName, amount, members, dateStr } = params;

  // Strip braces from interpolated free text so a club name containing { or }
  // can't be mis-read as a textV2 placeholder (our own keys are m0..mN).
  const esc = (s: string) => s.replace(/[{}]/g, "");

  const substitution: Record<string, LineMentionSubstitution> = {};
  const placeholders: string[] = [];
  members.forEach((m, i) => {
    const key = `m${i}`;
    substitution[key] = {
      type: "mention",
      mentionee: { type: "user", userId: m.lineUserId },
    };
    placeholders.push(`{${key}}`);
  });

  let text = placeholders.join(" ");
  if (text) text += "\n";
  text += `ค่าก๊วน${esc(clubName)}${dateStr ? ` ${esc(dateStr)}` : ""} · ${amount.toLocaleString(
    "en-US",
  )} บาท`;
  text += `\nสแกน QR ด้านล่างจ่ายได้เลย 🙏`;

  const msg: LineTextV2Message = { type: "textV2", text };
  if (placeholders.length > 0) msg.substitution = substitution;
  return msg;
}

// ---------------------------------------------------------------------------
// buildSlipImageMessage
// ---------------------------------------------------------------------------

/** Wrap an already-hosted slip PNG URL (client-rendered) as a LINE image message. */
export function buildSlipImageMessage(slipUrl: string): LineImageMessage {
  return {
    type: "image",
    originalContentUrl: slipUrl,
    previewImageUrl: slipUrl,
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
 * - The slip image (when `slipUrl` given) is appended as the last bubble so it
 *   sits directly under the tags. `slipUrl` is a client-rendered bill slip PNG
 *   (uploaded by the caller via `uploadBillSlipAction`), not a bare QR.
 * - The result is clamped to LINE's 5-messages-per-push limit; `overflow` is set
 *   true when clamping actually dropped a trailing text chunk so the caller can
 *   fall back (e.g. send remaining chunks in a second push).
 */
export function buildGroupBillMessages(
  bucket: GroupBillBucket,
  opts: { clubName: string; slipUrl: string | null; dateStr?: string },
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

  const imageMessages: LineMessage[] = opts.slipUrl
    ? [buildSlipImageMessage(opts.slipUrl)]
    : [];

  const all = [...textMessages, ...imageMessages];
  const messages = all.slice(0, MAX_MESSAGES_PER_PUSH);
  return { messages, overflow: all.length > messages.length };
}
