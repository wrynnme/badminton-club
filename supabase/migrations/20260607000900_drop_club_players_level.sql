-- club_players.level (text) is superseded by level_id FK → levels table.
-- All code refs removed (commit 8cd0e13); skill data migrated to level_id.
ALTER TABLE public.club_players DROP COLUMN IF EXISTS level;
