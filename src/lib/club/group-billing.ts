/**
 * group-billing.ts — pure helpers for collecting money inside a LINE **group**.
 *
 * The group flow posts ONE consolidated bill into the club's bound LINE group: a
 * numbered roster of who owes what, followed by a single amount-less PromptPay QR.
 *
 *     ค่าก๊วน <club> · 15 ก.ค. 68
 *     1. @bee 150       ← linked player → @mention (fires their notification)
 *     2. @pang 150
 *     3. Bank 120       ← guest / no LINE → plain display name
 *     4. DA 38
 *     สแกน QR ด้านล่างจ่ายได้เลย 🙏
 *     [QR image — no amount encoded]
 *
 * ── LINE API constraint that shapes this module ────────────────────────────
 * Sending a WORKING @mention requires **Text Message v2** (`type: "textV2"`) with
 * a `substitution` map: the text holds `{key}` placeholders and each key maps to a
 * `{type:"mention", mentionee:{type:"user", userId}}` entry. LINE renders each
 * placeholder as "@<that user's LINE display name>" and fires their notification.
 * (The older `text` + `mention.mentionees[]` index/length shape is the *inbound*
 * webhook format — on send LINE returns HTTP 200 but silently drops the mention.)
 *
 * A single message caps at 20 mentionees, and a push at 5 messages. When more than
 * 20 linked players owe money the list is split across messages with CONTINUOUS
 * numbering; the QR image is the final message. See buildGroupBillListMessages.
 *
 * Everything here is pure (no I/O). The QR image is rendered + hosted by the client
 * and its URL passed in; this module only decides *what* to send. LINE message
 * bodies stay in Thai by project convention (they are external, not UI strings).
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

/**
 * One rendered roster line — the single source of truth shared by the preview
 * dialog (which displays it) and the message composer (which turns `mentioned`
 * lines into textV2 placeholders). `index` is 1-based and continuous across the
 * whole list, independent of how the list is later chunked into messages.
 */
export type GroupBillListLine = {
  index: number;
  playerId: string;
  displayName: string;
  amount: number;
  /** true → has a LINE userId → rendered as @mention; false → plain name. */
  mentioned: boolean;
  lineUserId: string | null;
};

/** LINE hard limit: max 20 mentionees per message. */
export const MAX_MENTIONS_PER_MESSAGE = 20;
/** LINE hard limit: max 5 message objects per push request. */
export const MAX_MESSAGES_PER_PUSH = 5;
/** Soft cap on TOTAL roster lines per message. The 20-mention cap already bounds
 *  mention-heavy messages, but an all-plain (guest-heavy) roster consumes no
 *  mention budget and would otherwise pack every name into one textV2 body that
 *  could blow past LINE's ~5000-char text limit and fail the whole push. 40 lines
 *  (~1.2k chars even with long names) stays comfortably under. */
export const MAX_LINES_PER_MESSAGE = 40;

// ---------------------------------------------------------------------------
// buildGroupBillLines
// ---------------------------------------------------------------------------

/**
 * Order payable players into numbered roster lines: highest amount first, ties
 * keep input order (callers pass players already ordered by roster position).
 * Players owing `amount <= 0` are dropped (nothing to collect). Numbering is
 * assigned AFTER sorting so `index` matches display order.
 */
export function buildGroupBillLines(players: GroupBillPlayer[]): GroupBillListLine[] {
  return players
    .filter((p) => p.amount > 0)
    .slice()
    .sort((a, b) => b.amount - a.amount)
    .map((p, i) => ({
      index: i + 1,
      playerId: p.playerId,
      displayName: p.displayName,
      amount: p.amount,
      // Boolean() (not `!= null`) so an empty-string lineUserId also reads as
      // un-mentioned — the render guard below is `mentioned && lineUserId`, and a
      // truthy-but-empty id would otherwise consume a mention slot yet render plain.
      mentioned: Boolean(p.lineUserId),
      lineUserId: p.lineUserId,
    }));
}

/** Baht amount for a bill line: thousands-separated, trailing zeros trimmed (150, 38.5, 1,500). */
export function formatBillAmount(amount: number): string {
  return amount.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

// ---------------------------------------------------------------------------
// buildImageMessage
// ---------------------------------------------------------------------------

/** Wrap an already-hosted image URL (client-rendered QR PNG, or the club's
 *  uploaded PromptPay QR) as a LINE image message. */
export function buildImageMessage(url: string): LineImageMessage {
  return { type: "image", originalContentUrl: url, previewImageUrl: url };
}

// ---------------------------------------------------------------------------
// buildGroupBillListMessages
// ---------------------------------------------------------------------------

/** Strip braces from interpolated free text so a club name / display name that
 *  contains { or } can't be mis-read as one of our own textV2 placeholders. */
function esc(s: string): string {
  return s.replace(/[{}]/g, "");
}

/** The group-bill message header — `ค่าก๊วน <club> · <date>`. Exported so the
 *  preview dialog can render the EXACT header the push sends (single source). */
export function buildGroupBillHeader(clubName: string, dateStr?: string): string {
  return `ค่าก๊วน ${esc(clubName)}${dateStr ? ` · ${esc(dateStr)}` : ""}`;
}

/** Prompt line shown just above the QR image (and mirrored in the preview). */
export const GROUP_BILL_SCAN_PROMPT = "สแกน QR ด้านล่างจ่ายได้เลย 🙏";

/**
 * Compose the full `messages[]` for the group bill, ready for a LINE push whose
 * `to` is the group id.
 *
 * - Lines are packed into text messages so no single message exceeds 20 mentions
 *   (plain lines are free — they don't consume the mention budget). Numbering
 *   stays continuous across the split.
 * - Each mentioned line renders as `{index}. {mK} {amount}` with a per-message
 *   `substitution`; each plain line renders as `{index}. {name} {amount}`.
 * - The club/date header leads the FIRST kept message. When a QR is present the
 *   scan prompt trails the LAST kept text message and the QR image is appended as
 *   the final message. With no QR, no scan prompt and no image are added (text only).
 * - The chunk list is clamped to LINE's 5-messages-per-push limit BEFORE composing,
 *   so the header/scan-prompt land on messages that are actually sent. `overflow`
 *   is true when clamping dropped trailing chunks, and `sentPlayerIds` names exactly
 *   the players whose line made it into the push — the caller stamps only those, so
 *   dropped players are never marked billed for a message they never received.
 */
export function buildGroupBillListMessages(params: {
  lines: GroupBillListLine[];
  clubName: string;
  dateStr?: string;
  qrImageUrl: string | null;
}): { messages: LineMessage[]; overflow: boolean; sentPlayerIds: string[] } {
  const { lines, clubName, dateStr, qrImageUrl } = params;

  // 1. Pack lines into chunks. Start a new chunk when either the 20-mention cap or
  //    the total-lines cap (guest-heavy guard) would be exceeded by the next line.
  const chunks: GroupBillListLine[][] = [];
  let current: GroupBillListLine[] = [];
  let mentionsInChunk = 0;
  for (const line of lines) {
    const mentionFull = line.mentioned && mentionsInChunk >= MAX_MENTIONS_PER_MESSAGE;
    const linesFull = current.length >= MAX_LINES_PER_MESSAGE;
    if (current.length > 0 && (mentionFull || linesFull)) {
      chunks.push(current);
      current = [];
      mentionsInChunk = 0;
    }
    current.push(line);
    if (line.mentioned) mentionsInChunk++;
  }
  if (current.length > 0) chunks.push(current);
  // Nothing to bill → no messages at all.
  if (chunks.length === 0) return { messages: [], overflow: false, sentPlayerIds: [] };

  // 2. Clamp to LINE's 5-messages/push BEFORE composing. The QR is delivery-critical
  //    (people pay from it), so reserve its slot and drop excess trailing TEXT chunks.
  //    Clamping here (not after) keeps the header on chunk 0 and the scan prompt on
  //    the genuinely-last kept chunk, and lets us report which players were sent.
  const image: LineMessage[] = qrImageUrl ? [buildImageMessage(qrImageUrl)] : [];
  const maxText = MAX_MESSAGES_PER_PUSH - image.length;
  const keptChunks = chunks.slice(0, maxText);
  const overflow = chunks.length > keptChunks.length;

  const header = buildGroupBillHeader(clubName, dateStr);
  const lastKeptIdx = keptChunks.length - 1;

  // 3. Turn each KEPT chunk into one textV2 message.
  const textMessages: LineMessage[] = keptChunks.map((chunk, ci) => {
    const substitution: Record<string, LineMentionSubstitution> = {};
    let mIdx = 0; // substitution keys are per-message (m0..m19)
    const rows = chunk.map((line) => {
      const amount = formatBillAmount(line.amount);
      if (line.mentioned && line.lineUserId) {
        const key = `m${mIdx++}`;
        substitution[key] = {
          type: "mention",
          mentionee: { type: "user", userId: line.lineUserId },
        };
        return `${line.index}. {${key}} ${amount}`;
      }
      return `${line.index}. ${esc(line.displayName)} ${amount}`;
    });

    const parts: string[] = [];
    if (ci === 0) parts.push(header);
    parts.push(rows.join("\n"));
    if (ci === lastKeptIdx && qrImageUrl) parts.push(GROUP_BILL_SCAN_PROMPT);

    const msg: LineTextV2Message = { type: "textV2", text: parts.join("\n") };
    if (Object.keys(substitution).length > 0) msg.substitution = substitution;
    return msg;
  });

  const messages = [...textMessages, ...image];
  const sentPlayerIds = keptChunks.flat().map((l) => l.playerId);
  return { messages, overflow, sentPlayerIds };
}
