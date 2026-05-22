-- Drop deprecated singular column `tournaments.pair_division_threshold` (numeric, nullable).
-- Replaced by `pair_division_thresholds` (numeric[] NOT NULL default '{}') via migration
-- 20260522000100_add_pair_division_thresholds.sql, which migrated all data to the plural array.
-- App code no longer references this column. User has explicitly approved this DROP.

ALTER TABLE tournaments DROP COLUMN IF EXISTS pair_division_threshold;
