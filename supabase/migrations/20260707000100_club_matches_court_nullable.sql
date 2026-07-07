-- Courtless pending matches (club batch queue): batch generation inserts
-- court = NULL; the organizer assigns a court later via CourtSelect. NULL never
-- reaches in_progress (startClubMatchAction gains an explicit court gate), so
-- uniq_club_matches_inprogress_court keeps its occupancy guarantee unchanged.
ALTER TABLE public.club_matches ALTER COLUMN court DROP NOT NULL;
