-- Shuttle split mode 'by_time': split each hour-slot's shuttle COST among the
-- players present that hour, fixing the 'even' mode that overcharged players who
-- only played part of the session. Adds clubs.shuttle_hourly (shuttle COUNT per
-- 1-hour session slot, indexed by slot order) and widens the shuttle_split CHECK
-- to include 'by_time'. Additive / backward-compat: existing rows default to {}
-- and keep their current split mode.

ALTER TABLE public.clubs
  ADD COLUMN IF NOT EXISTS shuttle_hourly integer[] NOT NULL DEFAULT '{}';

ALTER TABLE public.clubs DROP CONSTRAINT IF EXISTS clubs_shuttle_split_check;

ALTER TABLE public.clubs
  ADD CONSTRAINT clubs_shuttle_split_check
  CHECK (shuttle_split IN ('even', 'per_match', 'per_player', 'by_time'));
