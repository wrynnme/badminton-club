-- Club named courts — part 1 of 2 (NON-BREAKING).
-- Adds clubs.courts text[] (mirror tournaments.courts) and backfills it from the
-- legacy queue_settings.court_count integer so every existing club keeps its
-- current layout, named "1".."N". Old deployed code never reads clubs.courts,
-- so this file is safe to apply at any time, independent of a code deploy.
--
-- The BREAKING half (club_matches.court int → text) lives in the separate file
-- 20260608000400_club_matches_court_text.sql — apply that one only together with
-- the prod code deploy, during a window with no live club session.

ALTER TABLE public.clubs
  ADD COLUMN IF NOT EXISTS courts text[] NOT NULL DEFAULT '{}';

-- Backfill ['1'..'N'] from queue_settings.court_count (default 1). The names
-- match the integer court values club_matches already store, so the upcoming
-- int → text cast (part 2) stays aligned.
UPDATE public.clubs c
SET courts = (
  SELECT array_agg(g::text ORDER BY g)
  FROM generate_series(1, GREATEST(1, COALESCE((c.queue_settings->>'court_count')::int, 1))) AS g
)
WHERE cardinality(c.courts) = 0;
