-- Done state for a รอบตี (grilled 2026-07-16): "ปิดรอบ" is a DISPLAY-ONLY flag —
-- closing hides the session from /clubs (hero + "รอบตีของฉัน") while /clubs/mine
-- and the series home keep full history with a "จบแล้ว" badge. Editing stays
-- open to managers; the active_session_id pointer is NOT cleared. NULL = open.
-- Sessions whose play_date has passed count as done automatically (derived in
-- code via isSessionDone(); no sweep/cron ever writes this column).

alter table public.clubs
  add column if not exists closed_at timestamptz;
