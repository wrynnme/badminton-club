-- Realtime for the club rotation queue via Broadcast-from-Database.
--
-- club_matches / club_players are RLS-locked from anon (PII safety, migration
-- 20260614000100) so postgres_changes (which needs an anon SELECT grant) is not an
-- option. Instead a trigger calls realtime.send() on a PUBLIC topic `club:<id>`
-- carrying only {club_id, table} — no row data, no PII. The anon browser client
-- subscribes to that topic for a "something changed" signal and re-fetches via the
-- server (service-role). No read grant on the club tables is opened.

create or replace function public.club_queue_broadcast()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid uuid := coalesce(new.club_id, old.club_id);
begin
  if cid is not null then
    perform realtime.send(
      jsonb_build_object('club_id', cid, 'table', tg_table_name),
      'change',
      'club:' || cid::text,
      false  -- public topic: anon may subscribe; payload is signal-only (no PII)
    );
  end if;
  return null;  -- AFTER trigger: return value ignored
end;
$$;

-- service_role-only convention: the function is fired by the trigger engine, not
-- called by clients, but strip default grants per the project RPC-hardening rule.
revoke execute on function public.club_queue_broadcast() from public, anon, authenticated;

drop trigger if exists club_matches_broadcast on public.club_matches;
create trigger club_matches_broadcast
  after insert or update or delete on public.club_matches
  for each row execute function public.club_queue_broadcast();

drop trigger if exists club_players_broadcast on public.club_players;
create trigger club_players_broadcast
  after insert or update or delete on public.club_players
  for each row execute function public.club_queue_broadcast();
