-- Part A: club rotation queue foundation.

-- Behavioral queue config as jsonb — extensible without DDL, mirrors tournaments.settings.
ALTER TABLE public.clubs
  ADD COLUMN IF NOT EXISTS queue_settings jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Rest-ordering input for queue_mode='rest_longest': when a player last finished a game.
-- NULL = has not played yet (treated as longest rest -> front of queue).
ALTER TABLE public.club_players
  ADD COLUMN IF NOT EXISTS last_finished_at timestamptz;

-- Live match queue. club_players.games_played becomes auto-derived (incremented on match
-- complete); manual entry remains the pre-queue fallback for clubs not using rotation.
-- side_*_player2 NULL = singles (players_per_team=1). Real FKs (not uuid[]) for cascade +
-- per-player queries, mirroring tournament pair_a_id/team_a_id idiom.
CREATE TABLE IF NOT EXISTS public.club_matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id uuid NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  court integer NOT NULL,
  side_a_player1 uuid NOT NULL REFERENCES public.club_players(id) ON DELETE CASCADE,
  side_a_player2 uuid REFERENCES public.club_players(id) ON DELETE CASCADE,
  side_b_player1 uuid NOT NULL REFERENCES public.club_players(id) ON DELETE CASCADE,
  side_b_player2 uuid REFERENCES public.club_players(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','in_progress','completed','cancelled')),
  queue_position integer,
  winner_side text CHECK (winner_side IN ('a','b')),
  score_a integer,
  score_b integer,
  started_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- One in-progress match per court (DB-level court occupancy guarantee; mirrors uniq_matches_inprogress_court).
CREATE UNIQUE INDEX IF NOT EXISTS uniq_club_matches_inprogress_court
  ON public.club_matches (club_id, court) WHERE status = 'in_progress';

CREATE INDEX IF NOT EXISTS idx_club_matches_club_status ON public.club_matches (club_id, status);
CREATE INDEX IF NOT EXISTS idx_club_matches_queue_position ON public.club_matches (club_id, queue_position);

-- FK covering indexes (consistent with 20260521000100_add_fk_indexes practice).
CREATE INDEX IF NOT EXISTS idx_club_matches_side_a_player1 ON public.club_matches (side_a_player1);
CREATE INDEX IF NOT EXISTS idx_club_matches_side_a_player2 ON public.club_matches (side_a_player2);
CREATE INDEX IF NOT EXISTS idx_club_matches_side_b_player1 ON public.club_matches (side_b_player1);
CREATE INDEX IF NOT EXISTS idx_club_matches_side_b_player2 ON public.club_matches (side_b_player2);

-- RLS: enable + read-all SELECT policy (mirror clubs/club_players); writes go through service role.
ALTER TABLE public.club_matches ENABLE ROW LEVEL SECURITY;
CREATE POLICY club_matches_read_all ON public.club_matches FOR SELECT USING (true);
