-- Phase 11 — cooldown source decoupled from audit_log_enabled
-- started_at set whenever status transitions to 'in_progress'.
-- Used by match_cooldown_minutes gate in startMatchAction.

ALTER TABLE matches
ADD COLUMN IF NOT EXISTS started_at timestamptz;

COMMENT ON COLUMN matches.started_at IS 'Phase 11 — set when status transitions to in_progress (manual start or auto_advance_next). Used by match_cooldown_minutes gate. Independent of audit_log_enabled.';

-- Backfill: in-progress matches without started_at get NOW() so cooldown still works after migration
UPDATE matches SET started_at = NOW() WHERE status = 'in_progress' AND started_at IS NULL;
