// Club cost split — pure, testable. Two independent buckets:
//   court_fee   → split "even" | "by_time" (per-segment fair share by presence)
//   shuttle_fee → split "even" | "by_games" (proportional to games played)
// See spec.md "ระบบคิดเงินก๊วน (Club cost split)".

export type CourtSplit = "even" | "by_time";
export type ShuttleSplit = "even" | "by_games";
export type GapPolicy = "spread" | "owner" | "ignore";

export type SplitPlayer = {
  id: string;
  /** "HH:MM" or "HH:MM:SS" — clamped to the session window. */
  start: string;
  end: string;
  games: number;
};

export type SplitInput = {
  players: SplitPlayer[];
  courtFee: number;
  courtSplit: CourtSplit;
  shuttleFee: number;
  shuttleSplit: ShuttleSplit;
  sessionStart: string;
  sessionEnd: string;
  gapPolicy?: GapPolicy;
  /** Required only when gapPolicy === "owner". */
  ownerId?: string;
};

export type SplitRow = {
  playerId: string;
  court: number;
  shuttle: number;
  total: number;
};

/** "HH:MM" / "HH:MM:SS" → minutes since 00:00. */
function toMin(t: string): number {
  const [h, m] = t.slice(0, 5).split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

/**
 * Round a bucket of exact per-player shares to whole baht while preserving the
 * collected total: every player rounds to nearest, then the leftover (target −
 * Σrounded) is dumped on the largest-exact payer. `target` is the rounded sum of
 * the EXACT shares (so an under-collecting gapPolicy stays under-collected).
 */
function roundBucket(exact: Map<string, number>): Map<string, number> {
  const rounded = new Map<string, number>();
  let sum = 0;
  let exactTotal = 0;
  for (const [id, v] of exact) {
    const r = Math.round(v);
    rounded.set(id, r);
    sum += r;
    exactTotal += v;
  }
  const diff = Math.round(exactTotal) - sum;
  if (diff !== 0 && exact.size > 0) {
    let largestId = "";
    let largestVal = -Infinity;
    for (const [id, v] of exact) {
      if (v > largestVal) { largestVal = v; largestId = id; }
    }
    rounded.set(largestId, (rounded.get(largestId) ?? 0) + diff);
  }
  return rounded;
}

function computeCourt(input: SplitInput): Map<string, number> {
  const { players, courtFee, courtSplit } = input;
  const out = new Map<string, number>(players.map((p) => [p.id, 0]));
  const n = players.length;
  if (n === 0 || courtFee <= 0) return out;

  if (courtSplit === "even") {
    const share = courtFee / n;
    for (const p of players) out.set(p.id, share);
    return out;
  }

  // by_time — segment the session by every player's clamped window boundary.
  const s0 = toMin(input.sessionStart);
  const s1 = toMin(input.sessionEnd);
  const sessionMin = s1 - s0;
  if (sessionMin <= 0) return out;

  // Per-player clamped window [ps, pe).
  const win = players.map((p) => {
    const ps = Math.max(toMin(p.start), s0);
    const pe = Math.min(toMin(p.end), s1);
    return { id: p.id, ps, pe };
  });

  const bounds = new Set<number>([s0, s1]);
  for (const w of win) {
    if (w.pe > w.ps) { bounds.add(w.ps); bounds.add(w.pe); }
  }
  const sorted = [...bounds].sort((a, b) => a - b);

  const gapPolicy = input.gapPolicy ?? "spread";
  for (let i = 0; i + 1 < sorted.length; i++) {
    const b1 = sorted[i];
    const b2 = sorted[i + 1];
    const segMin = b2 - b1;
    if (segMin <= 0) continue;
    const segCost = (courtFee * segMin) / sessionMin;
    const present = win.filter((w) => w.ps <= b1 && w.pe >= b2);

    if (present.length > 0) {
      const each = segCost / present.length;
      for (const w of present) out.set(w.id, (out.get(w.id) ?? 0) + each);
    } else {
      // Gap — nobody on court for this segment.
      if (gapPolicy === "ignore") continue;
      if (gapPolicy === "owner" && input.ownerId && out.has(input.ownerId)) {
        out.set(input.ownerId, (out.get(input.ownerId) ?? 0) + segCost);
      } else {
        // "spread" (and owner-fallback): share equally across all players.
        const each = segCost / n;
        for (const p of players) out.set(p.id, (out.get(p.id) ?? 0) + each);
      }
    }
  }
  return out;
}

function computeShuttle(input: SplitInput): Map<string, number> {
  const { players, shuttleFee, shuttleSplit } = input;
  const out = new Map<string, number>(players.map((p) => [p.id, 0]));
  const n = players.length;
  if (n === 0 || shuttleFee <= 0) return out;

  const totalGames = players.reduce((s, p) => s + Math.max(0, p.games), 0);
  // by_games with no games recorded falls back to even.
  if (shuttleSplit === "even" || totalGames === 0) {
    const share = shuttleFee / n;
    for (const p of players) out.set(p.id, share);
    return out;
  }

  for (const p of players) {
    out.set(p.id, (shuttleFee * Math.max(0, p.games)) / totalGames);
  }
  return out;
}

/**
 * Split a club session's court + shuttle fees across its players. Returns one
 * row per player with whole-baht court / shuttle / total shares; each bucket
 * sums to its collected total (court may under-collect when gapPolicy="ignore").
 */
export function computeClubSplit(input: SplitInput): SplitRow[] {
  const court = roundBucket(computeCourt(input));
  const shuttle = roundBucket(computeShuttle(input));
  return input.players.map((p) => {
    const c = court.get(p.id) ?? 0;
    const s = shuttle.get(p.id) ?? 0;
    return { playerId: p.id, court: c, shuttle: s, total: c + s };
  });
}
