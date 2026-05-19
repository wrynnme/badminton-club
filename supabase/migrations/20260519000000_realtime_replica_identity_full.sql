-- B1 fix — Realtime UPDATE events must include filter column (tournament_id) in the WAL stream
-- so the `filter: "tournament_id=eq.<uuid>"` channel filter actually matches.
-- DEFAULT identity only sends PK + changed columns; tournament_id never changes so filter never matches.
ALTER TABLE public.matches REPLICA IDENTITY FULL;
ALTER TABLE public.tournaments REPLICA IDENTITY FULL;
