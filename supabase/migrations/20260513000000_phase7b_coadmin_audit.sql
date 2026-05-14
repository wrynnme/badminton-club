-- Phase 7b: Co-admin + Audit Log
-- Applied: 2026-05-13

-- ============================================================
-- Table 1: tournament_admins
-- Stores co-admins (LINE users) granted access by the owner.
-- No soft delete — remove row to revoke.
-- added_at serves as both created_at and the only timestamp needed.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.tournament_admins (
  tournament_id  uuid        NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  user_id        text        NOT NULL,   -- LINE user_id of the co-admin
  added_by       text        NOT NULL,   -- LINE user_id of the owner who granted access
  added_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tournament_id, user_id)
);

-- Fast lookup: is this LINE user a co-admin in any tournament?
CREATE INDEX IF NOT EXISTS tournament_admins_user_id_idx
  ON public.tournament_admins(user_id);

-- ============================================================
-- Table 2: audit_logs
-- Append-only log of every significant action in a tournament.
-- event_type is plain text (not enum) for easy future extension.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id  uuid        NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  actor_id       text        NOT NULL,   -- LINE user_id of the person who acted
  actor_name     text        NOT NULL,   -- display_name snapshot at time of action
  event_type     text        NOT NULL,   -- e.g. 'score_recorded', 'player_added', 'status_changed'
  entity_type    text,                   -- 'match' | 'player' | 'team' | 'status' | 'admin' | 'bracket' | 'csv'
  entity_id      text,                   -- uuid or other id stored as text; nullable
  description    text        NOT NULL,   -- human-readable summary of what happened
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- Primary query pattern: all logs for a tournament, newest first
CREATE INDEX IF NOT EXISTS audit_logs_tournament_created_idx
  ON public.audit_logs(tournament_id, created_at DESC);
