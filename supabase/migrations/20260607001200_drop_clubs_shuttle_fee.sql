-- clubs.shuttle_fee superseded by shuttle_price (price-per-shuttle drives all 3
-- shuttle_split modes). All code refs removed + merged to prod; no view / CHECK /
-- function depends on it. Safe to drop.
ALTER TABLE public.clubs DROP COLUMN IF EXISTS shuttle_fee;
