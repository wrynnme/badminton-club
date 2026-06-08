-- Club named courts — part 2 of 2 (BREAKING — coordinate with deploy).
--
-- ⚠️  APPLY ORDERING ⚠️
--   club_matches.court is currently `integer NOT NULL`; the live, prod-deployed
--   club code (origin/master) both INSERTs it as an int (buildNextClubMatch /
--   createClubManualMatch) and reads it. After this cast it becomes text, so the
--   OLD int-court code would be writing/reading the wrong shape.
--
--   Therefore apply this file ONLY:
--     1. together with the prod code deploy that ships the named-courts UI, and
--     2. during a window with NO live club session (no matches being created or
--        scored) — club sessions are scheduled, so this window is free to pick.
--   At that point the court write/read path has zero in-flight traffic and the
--   int→text transition is invisible. Part 1 (clubs.courts add+backfill) is
--   non-breaking and may already be applied.
--
-- Verified against live DB 2026-06-08: court = integer NOT NULL, no CHECK
-- constraint / view / generated column / FK depends on it — only the partial
-- unique index uniq_club_matches_inprogress_court references it (dropped +
-- recreated below). Existing values {1..6} cast cleanly to '1'..'6', matching
-- the part-1 backfilled court names.

DROP INDEX IF EXISTS public.uniq_club_matches_inprogress_court;

ALTER TABLE public.club_matches
  ALTER COLUMN court TYPE text USING court::text;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_club_matches_inprogress_court
  ON public.club_matches (club_id, court) WHERE status = 'in_progress';
