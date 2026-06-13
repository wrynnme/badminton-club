-- Tournament-side analog of the club RLS lockdown (20260614000100).
-- All tournament data tables had `*_read_all` SELECT USING(true) policies for the
-- anon role + raw anon DML grants, so anyone with the browser-shipped publishable
-- key could read every tournament (incl ones with no share_token) and every
-- team_players row (player display_name + profile_id = PII) directly via PostgREST.
-- The notFound()/token gate + stats sanitizers only protect the SSR routes.
--
-- The app reads all of these via the service-role client (createAdminClient,
-- bypasses RLS). The ONLY anon-read dependency is Supabase Realtime, which
-- subscribes to `matches` + `tournaments` (postgres_changes) — including the
-- admin live-view of a not-yet-shared tournament — so those two keep anon SELECT.

-- 1) Tables NOT used by Realtime → fully lock (drop read policy + revoke all anon DML).
DROP POLICY IF EXISTS teams_read_all              ON public.teams;
DROP POLICY IF EXISTS team_players_read_all       ON public.team_players;
DROP POLICY IF EXISTS pairs_read_all              ON public.pairs;
DROP POLICY IF EXISTS groups_read_all             ON public.groups;
DROP POLICY IF EXISTS group_teams_read_all        ON public.group_teams;
DROP POLICY IF EXISTS tournament_classes_read_all ON public.tournament_classes;

REVOKE INSERT, UPDATE, DELETE, SELECT, TRUNCATE, REFERENCES, TRIGGER
  ON public.teams,
     public.team_players,
     public.pairs,
     public.groups,
     public.group_teams,
     public.tournament_classes
  FROM anon, authenticated;

-- 2) matches + tournaments: KEEP anon SELECT (Realtime needs it) but strip the raw
--    write grants so a future stray policy can't silently open writes (RLS stays
--    enabled with a SELECT-only policy → writes are already default-denied).
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.matches,
     public.tournaments
  FROM anon, authenticated;
