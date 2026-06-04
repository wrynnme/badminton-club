-- Phase 13 — Competition mode: link pairs / groups / matches to a class.
-- All three columns are nullable so existing sports_day rows (class_id = NULL)
-- stay valid; app logic enforces non-null only for `competition` tournaments.
-- pairs.class_id uses ON DELETE SET NULL (deleting a class un-assigns its pairs,
-- which are still real registrations); groups/matches CASCADE (they are derived
-- from a class and meaningless without it).

ALTER TABLE pairs   ADD COLUMN IF NOT EXISTS class_id uuid REFERENCES tournament_classes(id) ON DELETE SET NULL;
ALTER TABLE groups  ADD COLUMN IF NOT EXISTS class_id uuid REFERENCES tournament_classes(id) ON DELETE CASCADE;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS class_id uuid REFERENCES tournament_classes(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_pairs_class   ON pairs(class_id)   WHERE class_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_groups_class  ON groups(class_id)  WHERE class_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_matches_class ON matches(class_id) WHERE class_id IS NOT NULL;
