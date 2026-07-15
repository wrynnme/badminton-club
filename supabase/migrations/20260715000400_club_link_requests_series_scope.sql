-- ADR 0002 P1 — club_link_requests become series-scoped membership requests
-- (join a ก๊วน once, not once per นัด). Additive: legacy club_id stays NOT NULL
-- (new requests keep stamping it with the active session for UI back-compat);
-- series-level idempotency is enforced in the action layer (legacy rows may
-- legitimately hold multiple sessions' requests for one profile, so no new
-- unique index here). Applied to prod 2026-07-15 (P1 ship-check gate).

alter table public.club_link_requests
  add column if not exists series_id uuid references public.club_series(id) on delete cascade;

create index if not exists idx_club_link_requests_series_id
  on public.club_link_requests (series_id);

-- Backfill existing requests from their club's series (all clubs got a series
-- in 20260715000300). Idempotent.
update public.club_link_requests r
set series_id = c.series_id
from public.clubs c
where r.club_id = c.id
  and r.series_id is null
  and c.series_id is not null;
