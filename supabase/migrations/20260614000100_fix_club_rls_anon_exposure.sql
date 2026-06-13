-- SECURITY FIX (P0) — club tables were reachable by the anon role via PostgREST.
--
-- Root cause:
--   * club_admins / club_expenses had a policy named "service role bypass" that was
--     actually `FOR ALL TO public USING(true) WITH CHECK(true)` — the missing
--     `TO service_role` made it apply to anon+authenticated. Combined with the raw
--     anon INSERT/UPDATE/DELETE grants and the publishable key shipped to the browser,
--     anyone could INSERT INTO club_admins (self-grant co-admin → club takeover) or
--     read/forge/delete any club's club_expenses directly against the data API.
--   * clubs / club_players / club_matches / club_locked_pairs / levels / profiles all
--     had `*_read_all` SELECT policies USING(true) for public → anon could read every
--     club (incl is_public=false: total_cost, court_fee, notes…) and PII
--     (profiles.line_user_id, club_players.profile_id/note/discount). The notFound()
--     gate + toPublicClub/toPublicPlayer sanitizers only protect the SSR route and are
--     bypassed by a direct anon query.
--
-- Safe because every app read/write uses the service-role client (createAdminClient,
-- bypasses RLS); the anon browser client is used ONLY for tournament Realtime
-- (matches/tournaments). No club path and no profiles path depends on anon access.

-- 1) Remove the write-enabling ALL-to-public policies (privilege escalation / expense forgery).
DROP POLICY IF EXISTS "service role bypass" ON public.club_admins;
DROP POLICY IF EXISTS "service role bypass" ON public.club_expenses;

-- 2) Remove anon read on club data + profiles. RLS stays enabled; with no remaining
--    policy the default is deny for anon/authenticated, while service-role still bypasses.
DROP POLICY IF EXISTS clubs_read_all             ON public.clubs;
DROP POLICY IF EXISTS players_read_all           ON public.club_players;
DROP POLICY IF EXISTS club_matches_read_all      ON public.club_matches;
DROP POLICY IF EXISTS club_locked_pairs_read_all ON public.club_locked_pairs;
DROP POLICY IF EXISTS levels_read_all            ON public.levels;
DROP POLICY IF EXISTS profiles_read_all          ON public.profiles;

-- 3) Defense-in-depth: revoke the raw DML grants on club tables from anon/authenticated
--    so a future stray policy cannot silently re-open access (exactly what happened to
--    club_admins/club_expenses). service_role keeps its own grants + BYPASSRLS.
--    profiles is intentionally left untouched here (shared auth table; the dropped
--    policy already blocks anon reads, and its grants carry no policy to ride on).
REVOKE INSERT, UPDATE, DELETE, SELECT, TRUNCATE, REFERENCES, TRIGGER
  ON public.clubs,
     public.club_players,
     public.club_matches,
     public.club_locked_pairs,
     public.club_admins,
     public.club_expenses,
     public.levels
  FROM anon, authenticated;
