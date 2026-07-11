-- Club LINE linking: attach a real LINE account to an existing GUEST club_players row
-- so outbound pushes (bills, notifications) reach a player who was previously
-- profile_id IS NULL (counted as skippedNoLine by club billing). Additive only —
-- a per-club join token + a link-request pool table. Nothing here is referenced by
-- master code, so it is safe to apply to prod while the previous release is live.
-- Design: docs/adr/0001-line-linking-via-manager-confirmed-pool.md

-- Per-club join link token (mirrors tournaments.share_token). A manager generates and
-- shares it; a player who opens it and logs in with LINE drops a pending link request
-- into the club's pool.
ALTER TABLE public.clubs
  ADD COLUMN IF NOT EXISTS join_token text;

-- Unique when set; multiple NULLs allowed (clubs that never generated a join link).
CREATE UNIQUE INDEX IF NOT EXISTS uniq_clubs_join_token
  ON public.clubs (join_token)
  WHERE join_token IS NOT NULL;

-- Link pool: one row per profile that opted into a club via the join link, awaiting a
-- manager to link it to a guest roster player. UNIQUE(club_id, profile_id) makes a
-- repeat login idempotent (upsert on conflict), never a duplicate.
CREATE TABLE IF NOT EXISTS public.club_link_requests (
  id         uuid primary key default gen_random_uuid(),
  club_id    uuid not null references public.clubs(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  status     text not null default 'pending'
    check (status in ('pending', 'matched', 'rejected')),
  created_at timestamptz not null default now(),
  unique (club_id, profile_id)
);

-- Pool lookup by (club, status); FK covering index on profile_id.
CREATE INDEX IF NOT EXISTS idx_club_link_requests_pool
  ON public.club_link_requests (club_id, status);
CREATE INDEX IF NOT EXISTS idx_club_link_requests_profile
  ON public.club_link_requests (profile_id);

-- Read/write only via service-role server actions (mirrors the rest of the club schema).
-- profile_id maps to a LINE identity — never expose to anon. RLS on + no policy = deny
-- for anon/authenticated while service_role bypasses.
ALTER TABLE public.club_link_requests ENABLE ROW LEVEL SECURITY;

-- Defense-in-depth: revoke raw DML grants so a future stray policy cannot re-open access
-- (mirrors 20260614000100_fix_club_rls_anon_exposure).
REVOKE INSERT, UPDATE, DELETE, SELECT, TRUNCATE, REFERENCES, TRIGGER
  ON public.club_link_requests
  FROM anon, authenticated;
