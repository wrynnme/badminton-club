-- T3: migrate tournament `team_players` skill level from a free-text `level`
-- column to a `level_id` FK → `levels` (the shared skill-level table already
-- used by `club_players`). EXPAND step only — additive + backward-compatible:
-- the old `level` text column is left in place (currently-deployed prod code
-- keeps reading it) and is dropped later in a separate, confirmed migration
-- once all code reads `level_id`.
--
-- Backfill maps each existing free-text level to the `levels` row whose `real`
-- equals the parsed number. As of 2026-06-08 every prod row is "1"/"2"/"3"/"4"
-- → BG/N/S/P, so coverage is 100%; any value with no matching `levels.real`
-- is left NULL (admin re-selects from the dropdown).
ALTER TABLE public.team_players
  ADD COLUMN IF NOT EXISTS level_id uuid REFERENCES public.levels(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_team_players_level_id ON public.team_players(level_id);

UPDATE public.team_players tp
SET level_id = l.id
FROM public.levels l
WHERE tp.level_id IS NULL
  AND tp.level IS NOT NULL
  AND tp.level <> ''
  AND l.real = NULLIF(regexp_replace(tp.level, '[^0-9.]', '', 'g'), '')::numeric;
