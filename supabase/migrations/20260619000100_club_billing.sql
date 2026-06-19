-- Club billing: automatic LINE bill push + slip-based payment confirmation (Hybrid).
-- Additive only — bill snapshot + method on club_players, a slips table, and a
-- lightweight club audit log. Nothing here is referenced by master code, so it is
-- safe to apply to prod while the previous release is live.

ALTER TABLE public.club_players
  ADD COLUMN IF NOT EXISTS bill_amount    numeric(10,2),  -- amount snapshotted when the bill was pushed
  ADD COLUMN IF NOT EXISTS paid_method    text,           -- how paid_at was set: promptpay_slip | manual
  ADD COLUMN IF NOT EXISTS bill_pushed_at timestamptz;    -- when the LINE bill was last pushed (null = not pushed)

ALTER TABLE public.club_players
  DROP CONSTRAINT IF EXISTS club_players_paid_method_check;
ALTER TABLE public.club_players
  ADD CONSTRAINT club_players_paid_method_check
  CHECK (paid_method IS NULL OR paid_method IN ('promptpay_slip', 'manual'));

-- One row per submitted slip (retries allowed); the latest 'verified'/'manual' row confirms payment.
CREATE TABLE IF NOT EXISTS public.club_payment_slips (
  id              uuid primary key default gen_random_uuid(),
  club_id         uuid not null references public.clubs(id) on delete cascade,
  club_player_id  uuid not null references public.club_players(id) on delete cascade,
  image_path      text not null,                          -- object path in the private 'payment-slips' bucket
  amount_detected numeric(10,2),
  sender_name     text,
  receiver_name   text,
  trans_ref       text,
  verify_status   text not null default 'pending'
    check (verify_status in ('pending', 'verified', 'failed', 'manual')),
  verify_raw      jsonb,                                  -- raw provider response (audit / debugging)
  created_at      timestamptz not null default now()
);
CREATE INDEX IF NOT EXISTS idx_club_payment_slips_club   ON public.club_payment_slips (club_id, created_at desc);
CREATE INDEX IF NOT EXISTS idx_club_payment_slips_player ON public.club_payment_slips (club_player_id);
CREATE INDEX IF NOT EXISTS idx_club_payment_slips_review ON public.club_payment_slips (club_id)
  WHERE verify_status in ('failed', 'manual');

-- Lightweight club-scoped audit log (clubs had none; tournaments use audit_logs which is tournament_id NOT NULL).
CREATE TABLE IF NOT EXISTS public.club_audit_logs (
  id         uuid primary key default gen_random_uuid(),
  club_id    uuid not null references public.clubs(id) on delete cascade,
  actor_id   text,
  actor_name text,
  event_type text not null,
  detail     text,
  created_at timestamptz not null default now()
);
CREATE INDEX IF NOT EXISTS idx_club_audit_logs_club ON public.club_audit_logs (club_id, created_at desc);

-- Read/write only via service-role server actions (mirrors the rest of the club schema). Slips contain PII.
ALTER TABLE public.club_payment_slips ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.club_audit_logs    ENABLE ROW LEVEL SECURITY;

-- Private bucket for payment slips (NOT public, unlike club-qr) — read via signed URL / service role only.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('payment-slips', 'payment-slips', false, 3145728, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
