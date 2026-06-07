-- Add shuttle_split mode 'per_player': each player in a match pays the FULL
-- (shuttles × price), no division by player count. The previous CHECK only allowed
-- (even, per_match) and blocked per_player — drop + re-add with the wider set.
ALTER TABLE public.clubs DROP CONSTRAINT IF EXISTS clubs_shuttle_split_check;

ALTER TABLE public.clubs
  ADD CONSTRAINT clubs_shuttle_split_check
  CHECK (shuttle_split IN ('even', 'per_match', 'per_player'));
