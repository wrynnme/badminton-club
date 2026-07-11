-- Realtime for the LINE-link pool (club_link_requests) via the existing
-- Broadcast-from-Database signal.
--
-- club_link_requests is service-role-only (RLS on, no policy, REVOKE anon —
-- migration 20260711000100) and holds profile_id, so postgres_changes (which
-- needs an anon SELECT grant) is not an option. Reuse the generic
-- club_queue_broadcast() trigger function (20260615000100): it reads club_id +
-- tg_table_name and calls realtime.send() on the PUBLIC topic `club:<id>` with a
-- signal-only payload {club_id, table} — no row data, no profile_id on the wire.
--
-- Effect: when a player opts in (INSERT pending) or a manager links / dismisses /
-- unlinks (UPDATE / requeue), the manager's open club page (ClubLiveWrapper on the
-- `club:<id>` topic) debounces a router.refresh() and the pool updates live. The
-- fresh pool is always re-fetched server-side (service-role), so no read grant on
-- club_link_requests is opened.

drop trigger if exists club_link_requests_broadcast on public.club_link_requests;
create trigger club_link_requests_broadcast
  after insert or update or delete on public.club_link_requests
  for each row execute function public.club_queue_broadcast();
