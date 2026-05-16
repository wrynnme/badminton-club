-- Phase 10: list of court names per tournament for Schedule/Queue UX.
-- Ordered list — empty default means tournament has no managed court list (free-text fallback).

ALTER TABLE tournaments
  ADD COLUMN IF NOT EXISTS courts text[] NOT NULL DEFAULT '{}';
