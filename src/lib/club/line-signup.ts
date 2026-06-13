/**
 * Parses a LINE "ลงชื่อ" sign-up message into an ordered list of player names
 * and a reserve list, each with optional per-player time windows.
 *
 * No React / next-intl dependency — pure function, fully testable in Node.
 */

// A numbered roster line: a 1-3 digit number followed by a separator, then the
// name. The separator may be a dot/paren ("1. Kevin", "1) Kevin", "26.พี่โอ้ต")
// OR plain whitespace ("1 Kevin", "20 โม") — different LINE clients/organizers
// use either style. Requiring *some* separator avoids matching "1stCourt".
const NUMBERED_LINE_RE = /^\s*(\d{1,3})[.)\s]\s*(.*?)\s*$/u;
const SAMLANG_RE = /^\s*สำรอง\s*$/u;
// A "closed" marker line: either contains ❌ anywhere, or is just the word ปิด
// wrapped in any non-letter decoration — "❌❌ปิด❌❌", "***ปิด***", "===ปิด===".
// The decoration class is "anything that is not a letter/number" so it covers
// asterisks, equals, dashes, emoji and whitespace without enumerating each.
const CLOSE_RE = /❌|^[^\p{L}\p{N}]*ปิด[^\p{L}\p{N}]*$/u;

/**
 * Trailing time-window pattern. Matches (optionally parenthesised):
 *   H[:.]MM - H[:.]MM   e.g. 18.00-20.00  19:00-21:00  (19.00-21.00)
 * Hours 0-23 (leading zero optional), minutes 00-59.
 * The pattern must appear at the END of the string (after optional whitespace).
 * A middle-of-string occurrence is NOT extracted — only trailing.
 */
const TIME_WINDOW_RE =
  /\s*\(?\s*(\d{1,2})[:.](0[0-9]|[1-5][0-9])\s*[-–]\s*(\d{1,2})[:.](0[0-9]|[1-5][0-9])\s*\)?\s*$/u;

export type ParsedSignupPlayer = {
  name: string;
  start_time: string | null;
  end_time: string | null;
};

function zeroPad(n: string): string {
  return n.length === 1 ? `0${n}` : n;
}

// DB display_name limit. Clamp the NAME (after time extraction) so an over-long
// name can never sever a trailing time window mid-string.
function clampName(name: string): string {
  return name.length > 60 ? name.slice(0, 60) : name;
}

/**
 * Extract a trailing time window from a cleaned name string.
 * Returns { name, start_time, end_time } where times are "HH:MM" or null.
 * Only extracts from the very END of the string; mid-string times are ignored.
 * The returned name is clamped to the DB limit AFTER the time is stripped.
 */
function extractTime(raw: string): ParsedSignupPlayer {
  const m = TIME_WINDOW_RE.exec(raw);
  if (!m) return { name: clampName(raw), start_time: null, end_time: null };

  const startHour = parseInt(m[1], 10);
  const endHour = parseInt(m[3], 10);
  // Validate hour range 0-23.
  if (startHour > 23 || endHour > 23) return { name: clampName(raw), start_time: null, end_time: null };

  const start_time = `${zeroPad(m[1])}:${m[2]}`;
  const end_time = `${zeroPad(m[3])}:${m[4]}`;

  // Strip the matched time window (and any surrounding whitespace / parens).
  const name = raw.slice(0, raw.length - m[0].length).trimEnd();

  return { name: clampName(name), start_time, end_time };
}

// Normalize a raw roster cell: trim, collapse internal whitespace, strip a
// leading @. Does NOT clamp length — extractTime clamps the final name so the
// trailing time survives even when the raw cell exceeds the DB limit.
function cleanName(raw: string): string {
  let name = raw.trim();
  // Collapse internal runs of whitespace (space / tab / NBSP / ideographic space) to a single space.
  name = name.replace(/[\s 　]+/gu, " ").trim();
  // Strip a single leading @ only when the name itself starts with it.
  if (name.startsWith("@") && !name.startsWith("@ ")) {
    name = name.slice(1).trim();
  }
  return name;
}

export function parseLineSignup(text: string): {
  players: ParsedSignupPlayer[];
  reserves: ParsedSignupPlayer[];
} {
  const players: ParsedSignupPlayer[] = [];
  const reserves: ParsedSignupPlayer[] = [];

  if (!text.trim()) return { players, reserves };

  let reserveMode = false;
  let reserveClosed = false;

  for (const rawLine of text.split("\n")) {
    // Once reserves are closed (blank line after สำรอง section), ignore everything.
    if (reserveClosed) break;

    // --- Separator / close marker lines: skip, don't switch mode ---
    if (CLOSE_RE.test(rawLine)) continue;

    // --- Switch to reserve mode ---
    if (SAMLANG_RE.test(rawLine)) {
      reserveMode = true;
      continue;
    }

    if (reserveMode) {
      // A whitespace-only line (including single space) terminates the reserve section.
      if (/^\s*$/.test(rawLine)) {
        reserveClosed = true;
        break;
      }
      // Reserves may be numbered ("15. Name" or an empty held slot "15.") or a
      // plain name ("เอ"). Parse the numbered form first so empty slots — common
      // when an organizer reserves blank lines for walk-ins — are skipped rather
      // than imported as "15."/"16." junk names.
      const numbered = NUMBERED_LINE_RE.exec(rawLine);
      const cleaned = cleanName(numbered ? numbered[2] : rawLine);
      // Keep only lines with at least one letter/number — drops empty slots and
      // stray decoration lines (e.g. a leftover "****") that aren't real names.
      if (cleaned.length > 0 && /[\p{L}\p{N}]/u.test(cleaned)) {
        reserves.push(extractTime(cleaned));
      }
      continue;
    }

    // --- Numbered main-player line ---
    const m = NUMBERED_LINE_RE.exec(rawLine);
    if (m) {
      const cleaned = cleanName(m[2]);
      // A roster name must contain at least one letter. This rejects schedule /
      // court footers that happen to look numbered — "19.00 = 8-9-10",
      // "21.00 - 23.00", "20.00= 7-8-9-10" — whose "name" is only digits/symbols.
      if (cleaned.length > 0 && /\p{L}/u.test(cleaned)) {
        players.push(extractTime(cleaned));
      }
    }
    // Everything else outside numbered / สำรอง / close patterns is ignored.
  }

  return { players, reserves };
}
