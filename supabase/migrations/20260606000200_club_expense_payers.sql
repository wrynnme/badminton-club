-- Expense can be charged to specific designated players only.
-- Empty array {} = charged to ALL players (legacy even-split behavior preserved).
-- Non-empty = only those club_players split this expense among themselves.
ALTER TABLE public.club_expenses
  ADD COLUMN IF NOT EXISTS payer_player_ids uuid[] NOT NULL DEFAULT '{}';
