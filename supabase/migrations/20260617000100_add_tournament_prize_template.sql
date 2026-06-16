-- Prize summary feature: owner-configured award tiers per tournament.
-- Standalone jsonb column (mirrors `courts`/`pair_division_thresholds`), NOT inside
-- `settings`. Holds an array of { rank, label, cash, trophy }; validated app-side by
-- PrizeTemplateSchema (src/lib/tournament/prizes.ts). Default '[]' = no template set →
-- the /prizes page falls back to auto-labelled rows (champion/runner-up/semifinalist).
--
-- Idempotent: this column was first applied directly to the remote project; the guard
-- lets the file replay cleanly on prod and seed fresh databases.
alter table public.tournaments
  add column if not exists prize_template jsonb not null default '[]'::jsonb;
