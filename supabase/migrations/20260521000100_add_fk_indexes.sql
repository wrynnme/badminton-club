-- Performance: add covering indexes for foreign keys flagged by Supabase advisor.
-- All idempotent via IF NOT EXISTS. Partial indexes (WHERE col IS NOT NULL) on
-- nullable FK columns to keep size small when most rows have NULL.

-- matches (hot table — joined every tournament page)
CREATE INDEX IF NOT EXISTS idx_matches_team_a_id            ON public.matches(team_a_id)            WHERE team_a_id            IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_matches_team_b_id            ON public.matches(team_b_id)            WHERE team_b_id            IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_matches_next_match_id        ON public.matches(next_match_id)        WHERE next_match_id        IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_matches_loser_next_match_id  ON public.matches(loser_next_match_id)  WHERE loser_next_match_id  IS NOT NULL;

-- pairs (every pair-mode query embeds player1/player2 via FK)
CREATE INDEX IF NOT EXISTS idx_pairs_player_id_1 ON public.pairs(player_id_1);
CREATE INDEX IF NOT EXISTS idx_pairs_player_id_2 ON public.pairs(player_id_2);

-- group_teams (standings join)
CREATE INDEX IF NOT EXISTS idx_group_teams_team_id ON public.group_teams(team_id);

-- team_players (profile lookup)
CREATE INDEX IF NOT EXISTS idx_team_players_profile_id ON public.team_players(profile_id) WHERE profile_id IS NOT NULL;

-- club system
CREATE INDEX IF NOT EXISTS idx_clubs_owner_id            ON public.clubs(owner_id);
CREATE INDEX IF NOT EXISTS idx_club_admins_user_id       ON public.club_admins(user_id);
CREATE INDEX IF NOT EXISTS idx_club_admins_added_by      ON public.club_admins(added_by)        WHERE added_by        IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_club_players_profile_id   ON public.club_players(profile_id)     WHERE profile_id      IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_club_expenses_club_id     ON public.club_expenses(club_id);

-- tournament_admins
CREATE INDEX IF NOT EXISTS idx_tournament_admins_added_by ON public.tournament_admins(added_by) WHERE added_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tournament_admins_user_id  ON public.tournament_admins(user_id);
