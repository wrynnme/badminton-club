-- Club cost split: per-bucket split config on clubs + per-player session window
-- and game count on club_players. All additive/backward-compat (existing rows
-- get defaults; existing club pages ignore these until the UI ships).

ALTER TABLE public.clubs
  ADD COLUMN IF NOT EXISTS court_fee numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS court_split text NOT NULL DEFAULT 'even'
    CHECK (court_split IN ('even','by_time')),
  ADD COLUMN IF NOT EXISTS shuttle_fee numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS shuttle_split text NOT NULL DEFAULT 'even'
    CHECK (shuttle_split IN ('even','by_games')),
  ADD COLUMN IF NOT EXISTS court_gap_policy text NOT NULL DEFAULT 'spread'
    CHECK (court_gap_policy IN ('spread','owner','ignore'));

ALTER TABLE public.club_players
  ADD COLUMN IF NOT EXISTS start_time time,
  ADD COLUMN IF NOT EXISTS end_time time,
  ADD COLUMN IF NOT EXISTS games_played int NOT NULL DEFAULT 0;
