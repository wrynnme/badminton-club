-- Shuttle redesign: shuttle_price is per-shuttle (บาท/ต่อลูก) for BOTH modes; by_games ==
-- per_match (per-match shuttles ÷ players) so they merge. The old CHECK allowed only
-- (even, by_games) — it BLOCKED per_match writes (latent bug in the shipped per_match
-- feature, commit 95488da). Drop it, migrate by_games data, re-add CHECK for the new
-- valid set (even, per_match).
ALTER TABLE public.clubs DROP CONSTRAINT IF EXISTS clubs_shuttle_split_check;

UPDATE public.clubs SET shuttle_split = 'per_match' WHERE shuttle_split = 'by_games';

ALTER TABLE public.clubs
  ADD CONSTRAINT clubs_shuttle_split_check CHECK (shuttle_split IN ('even', 'per_match'));
