-- Fix matches_round_type_check constraint to allow lower bracket and grand_final
-- The original constraint was too restrictive for double-elimination / independent bracket formats
ALTER TABLE matches DROP CONSTRAINT IF EXISTS matches_round_type_check;

ALTER TABLE matches ADD CONSTRAINT matches_round_type_check
  CHECK (round_type IN ('group', 'knockout'));

ALTER TABLE matches DROP CONSTRAINT IF EXISTS matches_bracket_check;

ALTER TABLE matches ADD CONSTRAINT matches_bracket_check
  CHECK (bracket IS NULL OR bracket IN ('upper', 'lower', 'grand_final'));
