-- Close a concurrent double-link hole in the LINE-linking feature.
--
-- linkClubPlayerAction (src/lib/actions/club-linking.ts) guards the target row with
-- `.is("profile_id", null)`, which stops TWO profiles claiming the SAME guest row.
-- It does NOT stop ONE profile being linked to TWO different guest rows at once
-- (two manager tabs linking the same pending request to different rows): both pass
-- the racy app-level dup check, both targets are NULL, both writes succeed → the
-- profile ends up owning two active club_players rows (billing double-counts them,
-- confirmation push fires twice). The only reliable guard is at the DB.
--
-- Partial UNIQUE: at most one row per (club_id, profile_id) among LINKED rows.
-- profile_id IS NULL (guest rows) is unconstrained — a club can have many guests.
-- Verified 0 existing violators on prod before creating (2026-07-11).

create unique index if not exists uniq_club_players_profile
  on public.club_players (club_id, profile_id)
  where profile_id is not null;
