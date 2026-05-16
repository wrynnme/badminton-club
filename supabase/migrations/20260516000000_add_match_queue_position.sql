-- Add queue_position to matches for drag-drop ordering in Schedule/Queue tab.
-- Backfill from match_number scoped per tournament so existing matches retain order.

ALTER TABLE matches
  ADD COLUMN IF NOT EXISTS queue_position integer;

UPDATE matches AS m
SET queue_position = sub.rn
FROM (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY tournament_id
           ORDER BY match_number
         ) AS rn
  FROM matches
) AS sub
WHERE m.id = sub.id
  AND m.queue_position IS NULL;

CREATE INDEX IF NOT EXISTS idx_matches_tournament_queue_position
  ON matches (tournament_id, queue_position);
