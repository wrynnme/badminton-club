-- Migration: matches_division_numeric_text
-- Renames legacy division values 'upper' → '1' and 'lower' → '2' to support
-- the N-division model.  Division 1 = highest skill tier (was 'upper').
-- Adds a CHECK constraint to prevent non-numeric or out-of-range values
-- from being inserted in future.

-- Up -------------------------------------------------------------------------

-- Convention: 'upper' was the top (highest-skill) tier → Division 1.
--             'lower' was the second tier            → Division 2.
UPDATE matches SET division = '1' WHERE division = 'upper';
UPDATE matches SET division = '2' WHERE division = 'lower';

-- Guard against future drift.  Allows NULL (no division) or '1'..'99'.
ALTER TABLE matches DROP CONSTRAINT IF EXISTS matches_division_check;

ALTER TABLE matches
  ADD CONSTRAINT matches_division_check
  CHECK (division IS NULL OR division ~ '^[1-9][0-9]?$');

COMMENT ON COLUMN matches.division IS
  'Numeric text label for the division this match belongs to: '
  '''1'' = top tier (was ''upper''), ''2'' = next tier (was ''lower''), etc. '
  'NULL means the tournament has no division split.';

-- Down -----------------------------------------------------------------------
-- Reverting restores the legacy string values and drops the constraint.
-- NOTE: any division values > 2 introduced after this migration would be
-- set to NULL on rollback (no clean inverse exists for N > 2).

-- ALTER TABLE matches DROP CONSTRAINT IF EXISTS matches_division_check;
-- UPDATE matches SET division = 'upper' WHERE division = '1';
-- UPDATE matches SET division = 'lower' WHERE division = '2';
-- COMMENT ON COLUMN matches.division IS NULL;
