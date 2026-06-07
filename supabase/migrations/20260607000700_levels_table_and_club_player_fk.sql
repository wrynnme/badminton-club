-- Level system: a `levels` lookup (real numeric + label) referenced by FK, replacing
-- free-text level. CLUB scope first (team_players keeps its text level for now).
-- real = numeric value for math (pair_level sum / queue skill); label = display (BG, N-, …).
CREATE TABLE IF NOT EXISTS public.levels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  real numeric NOT NULL UNIQUE,
  label text NOT NULL UNIQUE,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.levels ENABLE ROW LEVEL SECURITY;
CREATE POLICY levels_read_all ON public.levels FOR SELECT USING (true);

-- Seed the 7 user-given levels + BG+ (1.25) which exists in current club data.
INSERT INTO public.levels (real, label, sort_order) VALUES
  (1,    'BG',  10),
  (1.25, 'BG+', 12),
  (1.5,  'N-',  15),
  (2,    'N',   20),
  (2.5,  'S-',  25),
  (3,    'S',   30),
  (3.5,  'P-',  35),
  (4,    'P',   40)
ON CONFLICT (label) DO NOTHING;

-- FK on club_players; keep the legacy text `level` column for fallback display.
ALTER TABLE public.club_players
  ADD COLUMN IF NOT EXISTS level_id uuid REFERENCES public.levels(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_club_players_level_id ON public.club_players(level_id);

-- Map existing labels (BG+, N, N-) to the seeded rows.
UPDATE public.club_players cp
  SET level_id = l.id
  FROM public.levels l
  WHERE cp.level_id IS NULL AND cp.level = l.label;
