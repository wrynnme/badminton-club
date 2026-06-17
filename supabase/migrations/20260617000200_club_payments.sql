-- Club payment collection: PromptPay receiver config on clubs + per-player paid status.
-- Manager-driven flow: player scans the manager's screen, manager marks them paid.

ALTER TABLE public.clubs
  ADD COLUMN IF NOT EXISTS promptpay_id       text,   -- mobile number / national ID (null = not set)
  ADD COLUMN IF NOT EXISTS promptpay_name     text,   -- receiver display name (shown above QR)
  ADD COLUMN IF NOT EXISTS promptpay_qr_image text;   -- Supabase Storage URL for uploaded QR (Phase 1b)

-- Per-player payment status (null = unpaid). Mirrors club_players.checked_in_at.
ALTER TABLE public.club_players
  ADD COLUMN IF NOT EXISTS paid_at timestamptz;

-- Fast "who paid" lookups within a club.
CREATE INDEX IF NOT EXISTS idx_club_players_paid
  ON public.club_players (club_id) WHERE paid_at IS NOT NULL;
