-- Series-first linking (grilled 2026-07-16): a link request no longer needs a
-- รอบตี to attach to — club_id becomes nullable; series_id (added in P1,
-- 20260715000400) is the real anchor. Non-destructive: no data changes.
--
-- The legacy UNIQUE (club_id, profile_id) treats NULLs as distinct, so
-- sessionless requests need their own dedupe: one pending/linked request per
-- (series, profile) among club-less rows. Insert paths treat 23505 as
-- "already requested" (same insert-when-absent semantics as before).

alter table public.club_link_requests alter column club_id drop not null;

create unique index if not exists uniq_club_link_requests_series_profile_sessionless
  on public.club_link_requests (series_id, profile_id)
  where club_id is null;
