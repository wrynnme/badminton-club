-- Club Presets: user-owned reusable club templates (config + co-admins + regulars as jsonb).
-- D1=jsonb single column · D2=one-shot seed via applyClubPresetAction · D3=manual template · D4=guest+optional profile link.
create table if not exists public.club_presets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_club_presets_owner on public.club_presets(owner_id);

-- All access is through server actions using the service-role key (which bypasses RLS) +
-- in-app assertPresetOwner checks. Enable RLS with NO public policy so anon/authenticated
-- clients cannot read other users' private templates directly.
alter table public.club_presets enable row level security;
