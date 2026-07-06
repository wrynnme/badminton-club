import {
  resolvePlayerWindow,
  proRatedTarget,
  countFixedAppearances,
  type BatchCountableMatch,
} from "@/lib/club/batch-queue";
import type { ClubMatch } from "@/lib/types";

// checked_in_at is a UTC timestamp — convert to Bangkok wall-clock HH:MM so it lines
// up with the club's start/end times (mirrors generateClubQueueAction server-side).
const CHECK_IN_HHMM = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "Asia/Bangkok",
});

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
 * GenerateQueueDialog. Eligibility mirrors the server's check-in gate; not_ready_action
 * nuance is ignored here since it only affects draft ordering, not who counts toward
 * "eligible for the preview".
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

  return eligible.map((p) => {
    const window = resolvePlayerWindow({
      declaredStart: p.start_time?.slice(0, 5) ?? null,
      declaredEnd: p.end_time?.slice(0, 5) ?? null,
      checkedInHHMM: p.checked_in_at ? CHECK_IN_HHMM.format(new Date(p.checked_in_at)) : null,
      clubStart,
      clubEnd,
    });
    const target = proRatedTarget(minMatches, window, clubStart, clubEnd);
    const have = existing.get(p.id) ?? 0;
    return { id: p.id, name: p.display_name, target, have, shortfall: Math.max(0, target - have) };
  });
}
