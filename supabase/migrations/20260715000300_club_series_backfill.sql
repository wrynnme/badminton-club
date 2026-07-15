-- ADR 0002 — club series backfill (assisted; preview approved by user 2026-07-15:
-- pure auto (owner_id, name) grouping, NO manual merges — MUGGLE×2 owners stay
-- separate, "MUGGLE TUESDAY "/"อังคาร" stay their own series).
--
-- COPY, not move: legacy clubs.line_group_id / join_token stay in place so the
-- currently-deployed code keeps working untouched; P1 switches reads to the
-- series (with legacy fallback) and CONTRACT drops the legacy columns later.
-- Idempotent: every statement guards against re-runs.
--
-- session_defaults shape seeded here (P2's zod schema must parse this):
--   { venue, start_time, end_time, max_players, court_fee, shuttle_price,
--     court_split, shuttle_split, courts, queue_settings }

-- 1) One series per (owner_id, name); bindings = latest non-null in the group;
--    active session = latest session; defaults seeded from the latest session.
with grp as (
  select
    owner_id,
    name,
    (array_agg(line_group_id order by play_date desc, created_at desc)
       filter (where line_group_id is not null))[1] as line_group_id,
    (array_agg(join_token order by play_date desc, created_at desc)
       filter (where join_token is not null))[1] as join_token,
    (array_agg(id order by play_date desc, created_at desc))[1] as active_session_id
  from public.clubs
  group by owner_id, name
)
insert into public.club_series
  (owner_id, name, line_group_id, join_token, active_session_id, session_defaults)
select
  g.owner_id, g.name, g.line_group_id, g.join_token, g.active_session_id,
  (
    select jsonb_build_object(
      'venue', c.venue,
      'start_time', c.start_time::text,
      'end_time', c.end_time::text,
      'max_players', c.max_players,
      'court_fee', c.court_fee,
      'shuttle_price', c.shuttle_price,
      'court_split', c.court_split,
      'shuttle_split', c.shuttle_split,
      'courts', to_jsonb(c.courts),
      'queue_settings', c.queue_settings
    )
    from public.clubs c
    where c.id = g.active_session_id
  )
from grp g
where not exists (
  select 1 from public.club_series s
  where s.owner_id = g.owner_id and s.name = g.name
);

-- 2) Point every legacy session at its series.
update public.clubs c
set series_id = s.id
from public.club_series s
where c.series_id is null
  and s.owner_id = c.owner_id
  and s.name = c.name;

-- 3) Membership registry from distinct LINE-linked roster rows (decision #5):
--    canonical_name + default level = latest linked roster row's values.
insert into public.series_members
  (series_id, profile_id, canonical_name, default_level_id, first_linked_at, last_linked_at)
select
  c.series_id,
  cp.profile_id,
  (array_agg(cp.display_name order by c.play_date desc, cp.joined_at desc))[1],
  (array_agg(cp.level_id order by c.play_date desc, cp.joined_at desc)
     filter (where cp.level_id is not null))[1],
  min(cp.joined_at),
  max(cp.joined_at)
from public.club_players cp
join public.clubs c on c.id = cp.club_id
where cp.profile_id is not null
  and c.series_id is not null
group by c.series_id, cp.profile_id
on conflict (series_id, profile_id) where profile_id is not null do nothing;

-- 4) Stamp attendance rows with their membership.
update public.club_players cp
set member_id = m.id
from public.clubs c, public.series_members m
where cp.club_id = c.id
  and cp.member_id is null
  and cp.profile_id is not null
  and m.series_id = c.series_id
  and m.profile_id = cp.profile_id;
