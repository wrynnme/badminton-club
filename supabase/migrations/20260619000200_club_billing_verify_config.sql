-- Per-club slip-verification config.
--
-- Non-secret config → clubs.billing_verify_settings jsonb (parsed like queue_settings).
-- BYOK api key → separate club_billing_secrets table, never joined into clubs.* selects.
--
-- mode "manual" (default): every club starts in manual mode (owner must confirm each slip).
-- mode "byok"            : owner provides their own provider (easyslip|slipok) + API key.
--                          Slip is auto-verified using the club's own key.
--
-- NOTE: this migration only creates the schema — no server code reads these env vars
-- (SLIP_VERIFY_PROVIDER / SLIP_VERIFY_API_KEY / SLIP_VERIFY_SLIPOK_BRANCH_ID) anymore;
-- those are deprecated. Provider config lives in clubs.billing_verify_settings + club_billing_secrets.

-- 1) Add per-club verify config column (non-breaking — DEFAULT handles existing rows).
ALTER TABLE public.clubs
  ADD COLUMN IF NOT EXISTS billing_verify_settings jsonb
    NOT NULL DEFAULT '{"mode":"manual"}'::jsonb;

-- 2) Separate secrets table — api_key is never exposed via a clubs.* join.
CREATE TABLE IF NOT EXISTS public.club_billing_secrets (
  club_id    uuid PRIMARY KEY REFERENCES public.clubs(id) ON DELETE CASCADE,
  api_key    text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 3) RLS lockdown (mirrors the pattern from 20260614000100_fix_club_rls_anon_exposure).
--    All reads/writes go through the service-role client (createAdminClient),
--    which bypasses RLS. anon + authenticated must never touch this table.
ALTER TABLE public.club_billing_secrets ENABLE ROW LEVEL SECURITY;

REVOKE INSERT, UPDATE, DELETE, SELECT, TRUNCATE, REFERENCES, TRIGGER
  ON public.club_billing_secrets
  FROM anon, authenticated;
