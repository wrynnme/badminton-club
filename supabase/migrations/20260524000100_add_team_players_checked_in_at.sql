ALTER TABLE team_players
  ADD COLUMN IF NOT EXISTS checked_in_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_team_players_checked_in
  ON team_players(team_id)
  WHERE checked_in_at IS NOT NULL;
