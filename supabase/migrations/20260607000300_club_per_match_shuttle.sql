-- Per-match shuttle cost model: each match consumes shuttles_used (default 1, can +);
-- cost = shuttles_used × shuttle_price, split among the players in that match.
-- New shuttle_split mode 'per_match' uses these; even/by_games keep using shuttle_fee.
ALTER TABLE public.clubs
  ADD COLUMN IF NOT EXISTS shuttle_price numeric NOT NULL DEFAULT 0;

ALTER TABLE public.club_matches
  ADD COLUMN IF NOT EXISTS shuttles_used integer NOT NULL DEFAULT 1
    CONSTRAINT club_matches_shuttles_nonneg CHECK (shuttles_used >= 0);
