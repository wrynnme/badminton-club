/**
 * session-done.ts — "ปิดรอบ" done state for a รอบตี (grilled 2026-07-16).
 * Display-only: a done session vanishes from /clubs (hero + "รอบตีของฉัน")
 * while /clubs/mine and the series home keep full history with a "จบแล้ว"
 * badge. Editing stays open and `active_session_id` is untouched. Done =
 * manually closed (`clubs.closed_at`) OR `play_date` already past — the auto
 * path is derived here so no cron ever writes the column.
 */

/** Today's date (YYYY-MM-DD) pinned to Asia/Bangkok — NOT the server's UTC clock. */
export function todayBangkok(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date());
}

export function isSessionDone(
  s: { play_date: string; closed_at: string | null },
  todayBkk: string,
): boolean {
  return s.closed_at !== null || s.play_date < todayBkk;
}

/** The not-done subset — names "live = not done" once for the surfaces that
 *  filter on it (/clubs list, series-home duplicate-day warning). */
export function liveSessions<T extends { play_date: string; closed_at: string | null }>(
  rows: T[],
  todayBkk: string,
): T[] {
  return rows.filter((r) => !isSessionDone(r, todayBkk));
}
