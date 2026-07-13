/**
 * line-self-link.ts — PURE helpers for the self-service LINE keyword-link flow.
 *
 * A player in a bound LINE group @mentions the bot and types their roster name:
 *
 *     @<bot> เชื่อมไลน์ <ชื่อในโพย>
 *
 * The webhook (src/app/api/line/webhook/route.ts) captures `source.userId` +
 * `source.groupId`, then uses these pure functions to (1) confirm the message is a
 * self-link command addressed to the bot and pull out the typed roster name, and
 * (2) classify that name against the club's roster. The DB orchestration + reply
 * live in the route; everything here is side-effect-free so it is unit-tested
 * directly (no Supabase, no LINE API).
 *
 * Design decisions (wayfinder map #49):
 *   - The bot @mention is REQUIRED — a bare prefix is not enough (reduces false
 *     triggers). The route detects it via `mention.mentionees[].isSelf === true`
 *     and passes `mentionedSelf` in.
 *   - Only a clean, UNIQUE match on a still-guest row (`profile_id IS NULL`)
 *     auto-links; ambiguous / already-claimed / not-found all fall back to the
 *     manager-confirmed pool. So `classifyRosterMatch` returns those four cases.
 */

/** A LINE inbound-mention entry (webhook receive format). */
export type Mentionee = {
  index?: number;
  length?: number;
  isSelf?: boolean;
  userId?: string;
  type?: string;
};

export type SelfLinkParse =
  | { kind: "link"; rosterName: string }
  | { kind: "usage" } // addressed the bot with the keyword but gave no name
  | null; // not a self-link command — ignore silently

export type RosterCandidate = {
  id: string;
  display_name: string;
  profile_id: string | null;
};

export type RosterMatch =
  | { kind: "unique"; playerId: string }
  | { kind: "ambiguous" }
  | { kind: "taken" } // a single name match, but that row is already linked
  | { kind: "not_found" };

// The keyword: เชื่อม optionally followed by ไลน์/ไลน/line, then the roster name.
const KEYWORD_RE = /^เชื่อม\s*(?:ไลน์|ไลน|line)?\s*(.*)$/i;

/** Normalize a name for comparison: trim, lowercase (latin), collapse whitespace. */
export function normalizeRosterName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Remove every @mention substring from the raw message text using the webhook's
 * mentionee offsets. LINE's index/length count UTF-16 code units, which matches
 * JS string slicing, so this correctly strips the bot mention (and any others)
 * regardless of the bot's display name — no name assumptions, no offset math in
 * the keyword regex. Ranges are removed high-index-first so earlier offsets stay
 * valid.
 */
export function stripMentions(text: string, mentionees?: Mentionee[]): string {
  if (!mentionees?.length) return text;
  const ranges = mentionees
    .filter(
      (m): m is Mentionee & { index: number; length: number } =>
        typeof m.index === "number" && typeof m.length === "number" && m.length > 0,
    )
    .sort((a, b) => b.index - a.index);

  let out = text;
  for (const m of ranges) {
    if (m.index < 0 || m.index >= out.length) continue;
    out = out.slice(0, m.index) + out.slice(m.index + m.length);
  }
  return out;
}

/**
 * Decide whether a group text message is a self-link command addressed to the bot,
 * and extract the typed roster name.
 *
 *   - `mentionedSelf` false  → null (bot not addressed; ignore)
 *   - keyword absent         → null (bot addressed for some other reason)
 *   - keyword, no name       → { kind: "usage" }
 *   - keyword + name         → { kind: "link", rosterName }
 */
export function parseSelfLinkCommand(
  text: string,
  mentionedSelf: boolean,
  mentionees?: Mentionee[],
): SelfLinkParse {
  if (!mentionedSelf) return null;

  const clean = stripMentions(text, mentionees).trim();
  const m = clean.match(KEYWORD_RE);
  if (!m) return null;

  const rosterName = m[1].trim();
  if (!rosterName) return { kind: "usage" };
  return { kind: "link", rosterName };
}

/**
 * Classify the typed roster name against the club's roster rows.
 *
 * Matches against ALL rows (not just guests) so an already-claimed name reports
 * "taken" rather than "not_found". Only an unambiguous single match on a row that
 * is still a guest (`profile_id === null`) is auto-linkable.
 */
export function classifyRosterMatch(
  rows: RosterCandidate[],
  rosterName: string,
): RosterMatch {
  const target = normalizeRosterName(rosterName);
  if (!target) return { kind: "not_found" };

  const matches = rows.filter((r) => normalizeRosterName(r.display_name) === target);
  if (matches.length === 0) return { kind: "not_found" };
  if (matches.length > 1) return { kind: "ambiguous" };

  const only = matches[0];
  if (only.profile_id !== null) return { kind: "taken" };
  return { kind: "unique", playerId: only.id };
}
