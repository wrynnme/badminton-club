-- Phase 11 — Pre-tournament settings (feature flags)
-- Per-tournament jsonb bag. Shape validated by src/lib/tournament/settings.ts (zod).
-- Owner-only writes via updateTournamentSettingsAction.

ALTER TABLE tournaments
ADD COLUMN IF NOT EXISTS settings jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN tournaments.settings IS 'Phase 11 — per-tournament feature flags. Shape validated by src/lib/tournament/settings.ts (zod). Owner-only writes via updateTournamentSettingsAction.';
