-- Per-player discount entered in the club cost breakdown. Subtracted from the
-- player's grand total (court + shuttle + personal expense − discount).
ALTER TABLE public.club_players
  ADD COLUMN IF NOT EXISTS discount numeric NOT NULL DEFAULT 0;
