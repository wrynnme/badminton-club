-- ADR 0002 — club series (ก๊วนถาวร) EXPAND phase: additive DDL only.
-- A club_series is the persistent real-world club ("MUGGLE"); the existing
-- clubs rows become its sessions (นัด). LINE bindings + membership live at
-- series level so "link once, use forever" holds across sessions. Existing
-- code is untouched by this migration (all new columns nullable / defaulted);
-- cutover happens in later PRs (P1..P4), legacy columns drop at CONTRACT.
-- Full design + 15 grilled decisions: docs/adr/0002 + spec.md.

-- ── club_series ──────────────────────────────────────────────────────────────
create table if not exists public.club_series (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  -- LINE bindings live HERE (once, forever) — never move between sessions.
  line_group_id text,
  join_token text,
  -- "นัดปัจจุบัน" pointer (decision #3): set on open-session, manually switchable.
  -- Webhook keyword-link + join-link auto-link target this session's roster.
  active_session_id uuid references public.clubs(id) on delete set null,
  -- decision #12: ad-hoc one-off groups are hidden series (full LINE features,
  -- single binding architecture); upgrading to a full ก๊วน just names + flips this.
  is_adhoc boolean not null default false,
  -- decision #13: retired clubs archive (hidden from lists, fully recoverable).
  archived_at timestamptz,
  -- decision #15: explicit session defaults (venue/times/fees/queue_settings/
  -- courts) — "จัดก๊วน" reads this; per-session edits never write back.
  session_defaults jsonb not null default '{}',
  created_at timestamptz not null default now()
);

-- One LINE group / join token binds to at most one series (mirrors the legacy
-- per-club partial uniques). NULL (unbound) rows are unconstrained.
create unique index if not exists uniq_club_series_line_group_id
  on public.club_series (line_group_id)
  where line_group_id is not null;

create unique index if not exists uniq_club_series_join_token
  on public.club_series (join_token)
  where join_token is not null;

create index if not exists idx_club_series_owner_id on public.club_series (owner_id);
create index if not exists idx_club_series_active_session_id
  on public.club_series (active_session_id);

-- Service-role only (club-table invariant since 20260614: RLS on, NO policies).
alter table public.club_series enable row level security;

-- ── series_members (ทะเบียนสมาชิกถาวร) ───────────────────────────────────────
create table if not exists public.series_members (
  id uuid primary key default gen_random_uuid(),
  series_id uuid not null references public.club_series(id) on delete cascade,
  -- decision #11: nullable — a name-only member (no LINE) is first-class and
  -- upgrades in place when they link. Mirrors club_players.profile_id semantics.
  profile_id uuid references public.profiles(id) on delete set null,
  canonical_name text not null,
  default_level_id uuid references public.levels(id) on delete set null,
  -- decision #2: regulars auto-seed the roster when a session opens.
  is_regular boolean not null default true,
  first_linked_at timestamptz not null default now(),
  last_linked_at timestamptz not null default now()
);

-- A LINE identity joins a series at most once (name-only members excluded).
create unique index if not exists uniq_series_members_profile
  on public.series_members (series_id, profile_id)
  where profile_id is not null;

create index if not exists idx_series_members_series_id on public.series_members (series_id);
create index if not exists idx_series_members_profile_id on public.series_members (profile_id);
create index if not exists idx_series_members_default_level_id
  on public.series_members (default_level_id);

alter table public.series_members enable row level security;

-- ── series_partner_pairs (คู่ประจำระดับก๊วน — decision #6) ────────────────────
-- Instantiated into per-session club_locked_pairs on open-session; the queue
-- engine keeps reading only the per-session table.
create table if not exists public.series_partner_pairs (
  id uuid primary key default gen_random_uuid(),
  series_id uuid not null references public.club_series(id) on delete cascade,
  member1_id uuid not null references public.series_members(id) on delete cascade,
  member2_id uuid not null references public.series_members(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint series_partner_pairs_distinct check (member1_id <> member2_id)
);

create index if not exists idx_series_partner_pairs_series_id
  on public.series_partner_pairs (series_id);
create index if not exists idx_series_partner_pairs_member1_id
  on public.series_partner_pairs (member1_id);
create index if not exists idx_series_partner_pairs_member2_id
  on public.series_partner_pairs (member2_id);

alter table public.series_partner_pairs enable row level security;

-- ── link existing tables (nullable — legacy rows stay NULL) ──────────────────
-- RESTRICT enforces decision #13 at the DB level: a series with sessions
-- remaining cannot be deleted (delete sessions first / archive instead).
alter table public.clubs
  add column if not exists series_id uuid references public.club_series(id) on delete restrict;

create index if not exists idx_clubs_series_id on public.clubs (series_id);

-- Attendance row → membership (walk-ins stay NULL).
alter table public.club_players
  add column if not exists member_id uuid references public.series_members(id) on delete set null;

create index if not exists idx_club_players_member_id on public.club_players (member_id);
