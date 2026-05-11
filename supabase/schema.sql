-- Badminton Club schema
-- Run in Supabase SQL editor

create extension if not exists "pgcrypto";

-- Profiles (LINE users + guests)
create table if not exists public.profiles (
  id uuid primary key default gen_random_uuid(),
  line_user_id text unique,
  display_name text not null,
  picture_url text,
  is_guest boolean not null default false,
  created_at timestamptz not null default now()
);

-- Clubs (ก๊วน)
create table if not exists public.clubs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  venue text not null,
  play_date date not null,
  start_time time not null,
  end_time time not null,
  max_players int not null default 12,
  total_cost numeric(10,2) default null,
  shuttle_info text,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists clubs_play_date_idx on public.clubs(play_date desc);

-- Players (signups for a club)
create table if not exists public.club_players (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  profile_id uuid references public.profiles(id) on delete set null,
  display_name text not null,
  level text,
  note text,
  joined_at timestamptz not null default now(),
  unique (club_id, profile_id)
);

create index if not exists club_players_club_id_idx on public.club_players(club_id);

-- RLS
alter table public.profiles enable row level security;
alter table public.clubs enable row level security;
alter table public.club_players enable row level security;

-- Public read on clubs + players (anyone can browse)
drop policy if exists "clubs_read_all" on public.clubs;
create policy "clubs_read_all" on public.clubs for select using (true);

drop policy if exists "players_read_all" on public.club_players;
create policy "players_read_all" on public.club_players for select using (true);

drop policy if exists "profiles_read_all" on public.profiles;
create policy "profiles_read_all" on public.profiles for select using (true);

-- Writes are funneled through server actions using service role for now.
-- Tighten later when you add Supabase Auth or a JWT bridge from LINE.
