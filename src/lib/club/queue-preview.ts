import {
  computePlayerTargets,
  countFixedAppearances,
  type BatchCountableMatch,
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
