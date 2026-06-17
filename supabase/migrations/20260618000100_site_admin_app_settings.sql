-- Site-owner flag (a single privileged account edits global settings).
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_site_admin boolean NOT NULL DEFAULT false;

-- Global app settings — singleton row (id is always 1). Holds the centre-of-QR
-- PromptPay logo config shared by every club's generated QR.
CREATE TABLE IF NOT EXISTS public.app_settings (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  qr_logo_enabled boolean NOT NULL DEFAULT true,
  qr_logo_url text,                       -- null = use the bundled default (/thaiqr-logo.png)
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.app_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
