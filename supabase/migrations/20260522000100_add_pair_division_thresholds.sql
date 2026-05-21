-- Migration: add_pair_division_thresholds
-- Extends the single pair_division_threshold (numeric) to an ordered array
-- (numeric[]) to support N-division tournament structures (Division 1..N).
-- The legacy column is kept untouched this release; it will be dropped in a
-- follow-up migration once the application layer has been updated.

-- Up -------------------------------------------------------------------------

ALTER TABLE tournaments
  ADD COLUMN IF NOT EXISTS pair_division_thresholds numeric[] NOT NULL DEFAULT '{}';

-- Backfill: existing scalar threshold becomes a single-element array.
-- Only rows that have not yet been populated are touched (idempotent).
UPDATE tournaments
   SET pair_division_thresholds = ARRAY[pair_division_threshold]::numeric[]
 WHERE pair_division_threshold IS NOT NULL
   AND pair_division_thresholds = '{}';

-- Enforce ascending sort order at the DB level.
-- The application layer also sorts before writing, but the constraint
-- prevents any future out-of-order insert from drifting silently.
-- Postgres CHECK constraints disallow subqueries, so the predicate is
-- delegated to an IMMUTABLE helper function.
CREATE OR REPLACE FUNCTION is_numeric_array_sorted_asc(arr numeric[])
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(bool_and(arr[i] <= arr[i + 1]), true)
    FROM generate_subscripts(arr, 1) AS i
   WHERE i < array_length(arr, 1);
$$;

ALTER TABLE tournaments
  DROP CONSTRAINT IF EXISTS pair_division_thresholds_sorted;

ALTER TABLE tournaments
  ADD CONSTRAINT pair_division_thresholds_sorted
  CHECK (is_numeric_array_sorted_asc(pair_division_thresholds));

COMMENT ON COLUMN tournaments.pair_division_threshold IS
  'DEPRECATED — use pair_division_thresholds[]. Kept for one release for '
  'backwards safety; drop in the follow-up migration once app layer is updated.';

COMMENT ON COLUMN tournaments.pair_division_thresholds IS
  'Ordered ascending array of numeric thresholds that define N divisions. '
  'Empty array = no division split. '
  'Example: ARRAY[3.0, 5.0] → Division 1: pair_level > 5, '
  'Division 2: pair_level 3..5, Division 3: pair_level ≤ 3.';

-- Down -----------------------------------------------------------------------
-- Reverting removes the constraint and the new column.
-- The legacy pair_division_threshold column is left intact (it was not changed).

-- ALTER TABLE tournaments DROP CONSTRAINT IF EXISTS pair_division_thresholds_sorted;
-- ALTER TABLE tournaments DROP COLUMN IF EXISTS pair_division_thresholds;
-- COMMENT ON COLUMN tournaments.pair_division_threshold IS NULL;
