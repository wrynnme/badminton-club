-- Per-club skill levels — CONTRACT step: drop the old global UNIQUE constraints.
-- The partial WHERE-clause indexes added in 20260613000100 now enforce global
-- uniqueness (club_id IS NULL scope) instead, so the table-level constraints are
-- redundant and actively harmful: they would reject two clubs each defining a
-- level with the same label or real value.
-- No data change — pure constraint relaxation.
ALTER TABLE public.levels DROP CONSTRAINT IF EXISTS levels_label_key;
ALTER TABLE public.levels DROP CONSTRAINT IF EXISTS levels_real_key;
