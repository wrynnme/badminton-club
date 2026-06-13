-- Per-club skill levels — EXPAND step: add nullable club_id to levels.
-- club_id IS NULL  = global default set (visible to all clubs + tournament fallback).
-- club_id = <uuid> = a club's own customized copy of the level ladder.
-- Existing rows are unaffected (all remain global, club_id stays NULL).
ALTER TABLE public.levels
  ADD COLUMN IF NOT EXISTS club_id uuid REFERENCES public.clubs(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_levels_club_id ON public.levels(club_id);

-- Scoped uniqueness. A plain UNIQUE(club_id, label) would NOT deduplicate global rows
-- because NULL != NULL in SQL, so two global rows with the same label would pass.
-- Partial indexes give us correct semantics for each scope independently.
CREATE UNIQUE INDEX IF NOT EXISTS levels_global_label_uniq ON public.levels (label)          WHERE club_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS levels_global_real_uniq  ON public.levels ("real")         WHERE club_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS levels_club_label_uniq   ON public.levels (club_id, label) WHERE club_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS levels_club_real_uniq    ON public.levels (club_id, "real") WHERE club_id IS NOT NULL;
