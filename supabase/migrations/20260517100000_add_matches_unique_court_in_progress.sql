-- Phase 10 hardening: enforce one in_progress match per (tournament, court).
-- Pending/completed matches and NULL courts are excluded by the WHERE clause.

CREATE UNIQUE INDEX IF NOT EXISTS uniq_matches_inprogress_court
  ON matches (tournament_id, court)
  WHERE status = 'in_progress' AND court IS NOT NULL;
