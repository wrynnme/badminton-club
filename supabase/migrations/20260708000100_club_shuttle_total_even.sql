-- Manual total shuttle count for shuttle_split='even'. 0 = derive the count from
-- match shuttles_used (count from actual games played); > 0 overrides that total.
ALTER TABLE clubs
  ADD COLUMN IF NOT EXISTS shuttle_total integer NOT NULL DEFAULT 0;

ALTER TABLE clubs
  ADD CONSTRAINT clubs_shuttle_total_nonneg CHECK (shuttle_total >= 0);
