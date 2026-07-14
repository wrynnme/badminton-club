import {
  computePlayerTargets,
  countFixedAppearances,
  playerPresenceMinutes,
  type BatchCountableMatch,
  type PlayerTargetRow,
} from "@/lib/club/batch-queue";
import type { ClubMatch } from "@/lib/types";

export type PreviewPlayer = {
  id: string;
  display_name: string;
  status: string;
  checked_in_at: string | null;
  start_time: string | null;
  end_time: string | null;
};

export type PreviewRow = {
  id: string;
  name: string;
  target: number;
  have: number;
  shortfall: number;
};

/**
 * Client-side mirror of generateClubQueueAction's per-player target math (informational
 * preview only — the server recomputes authoritatively at submit time), used by
 * GenerateQueueDialog. Eligibility mirrors the server's check-in gate: checked-in
 * players only when anyone has checked in, else the whole active roster.
 *
 * Kept in a framework-free lib module (not the "use client" dialog file) so it can be
 * unit tested directly — importing anything under `@/lib/actions/*` ("use server" files,
 * which pull in `server-only`) from a vitest node-environment test throws at import time.
 */
export function buildPreviewRows(
  activePlayers: PreviewPlayer[],
  matches: ClubMatch[],
  minMatches: number,
  clubStart: string,
  clubEnd: string,
): PreviewRow[] {
  const anyCheckedIn = activePlayers.some((p) => p.checked_in_at != null);
  const eligible = anyCheckedIn
    ? activePlayers.filter((p) => p.checked_in_at != null)
    : activePlayers;
  const existing = countFixedAppearances(matches as BatchCountableMatch[]);
  // Same target math as generateClubQueueAction (shared helper) so preview == server.
  const targets = computePlayerTargets(eligible, minMatches, clubStart, clubEnd, existing);

  return eligible.map((p) => {
    const t = targets.get(p.id)!;
    return { id: p.id, name: p.display_name, target: t.target, have: t.have, shortfall: t.shortfall };
  });
}

// ─── Locked-pair time-mismatch warning ───────────────────────────────────────

/** a roster row with its presence window + display name (for lock warnings) */
export type LockPlayerTimes = PlayerTargetRow & { display_name: string };

/** minimal shape of a locked pair — just the two player ids */
export type LockPairIds = { player1_id: string; player2_id: string };

export type LockedPairMismatch = {
  /** the player present for LESS of the session — the one dragged above their target */
  shorterId: string;
  shorterName: string;
  shorterMinutes: number;
  longerName: string;
  longerMinutes: number;
};

/**
 * Locked pairs whose two players are present for different amounts of the session.
 * A locked pair always plays together, so the shorter-staying player is scheduled as
 * often as their partner — overriding their (lower) pro-rated target. Surfaced as a
 * warning in the lock UI and the สุ่มคิว dialog so a manager can see the conflict
 * BEFORE it silently inflates a late/early player's match count. N-independent: keyed
 * on presence minutes, not on the target's rounding.
 */
export function findLockedPairMismatches(
  players: LockPlayerTimes[],
  locks: LockPairIds[],
  clubStart: string,
  clubEnd: string,
): LockedPairMismatch[] {
  const byId = new Map(players.map((p) => [p.id, p]));
  const out: LockedPairMismatch[] = [];
  for (const lock of locks) {
    const a = byId.get(lock.player1_id);
    const b = byId.get(lock.player2_id);
    if (!a || !b) continue;
    const ma = playerPresenceMinutes(a, clubStart, clubEnd);
    const mb = playerPresenceMinutes(b, clubStart, clubEnd);
    if (ma === mb) continue;
    const [shorter, longer, sm, lm] = ma < mb ? [a, b, ma, mb] : [b, a, mb, ma];
    out.push({
      shorterId: shorter.id,
      shorterName: shorter.display_name,
      shorterMinutes: sm,
      longerName: longer.display_name,
      longerMinutes: lm,
    });
  }
  return out;
}
