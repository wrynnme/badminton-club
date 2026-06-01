-- Phase 13 — Competition mode: per-tournament event classes (NB/BG/N/S/P-…).
-- A class is event-scoped (not a player/pair master attribute): it carries the
-- per-class format/capacity/grouping config that sports_day expressed at the
-- tournament level. Nullable class_id columns are added to pairs/groups/matches
-- in the companion migration so existing sports_day data stays valid.

CREATE TABLE IF NOT EXISTS tournament_classes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id uuid NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  code text NOT NULL,                  -- "NB", "BG", "N", "S", "P-"
  name text NOT NULL,                  -- "มือใหม่"
  pair_capacity int CHECK (pair_capacity IS NULL OR pair_capacity >= 0),  -- null = unlimited
  pairs_per_group int NOT NULL DEFAULT 4 CHECK (pairs_per_group > 0),
  -- format/match_format stored as text + CHECK to match the project convention
  -- (tournaments.format is text, not a pg enum).
  format text NOT NULL DEFAULT 'group_knockout'
    CHECK (format IN ('group_only', 'group_knockout', 'knockout_only')),
  advance_count int NOT NULL DEFAULT 2 CHECK (advance_count >= 0),
  has_lower_bracket boolean NOT NULL DEFAULT false,
  allow_drop_to_lower boolean NOT NULL DEFAULT false,
  match_format text NOT NULL DEFAULT 'best_of_3'
    CHECK (match_format IN ('fixed_2', 'best_of_3', 'best_of_5')),
  position int NOT NULL DEFAULT 0,     -- display order
  created_at timestamptz DEFAULT now(),
  UNIQUE (tournament_id, code)
);

CREATE INDEX IF NOT EXISTS idx_tournament_classes_tournament
  ON tournament_classes(tournament_id);

-- RLS: mirror peer tables (groups/pairs/matches) — public read, writes via
-- service role (which bypasses RLS). No insert/update/delete policy on purpose.
ALTER TABLE tournament_classes ENABLE ROW LEVEL SECURITY;

CREATE POLICY tournament_classes_read_all
  ON tournament_classes FOR SELECT
  USING (true);
