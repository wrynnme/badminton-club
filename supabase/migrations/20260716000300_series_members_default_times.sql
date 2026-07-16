-- Member default presence window (grilled 2026-07-16): a member who habitually
-- arrives late / leaves early gets per-member default times; เปิดรอบตี seeds
-- them into the roster row's start_time/end_time (pro-rated queue target +
-- time-based billing already read those). NULL = present for the whole รอบตี.
-- Applies to NEWLY-opened sessions only — never rewrites an open roster.

alter table public.series_members
  add column if not exists default_start_time time,
  add column if not exists default_end_time time;
