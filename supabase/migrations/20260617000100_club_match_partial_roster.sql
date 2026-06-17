-- Partial-roster club matches: let an organizer reserve a match/court with as few
-- as 1 player and fill the rest later. Pre-this, side_a_player1 + side_b_player1 were
-- NOT NULL, so a match could only be created when fully staffed (auto-queue or a
-- complete manual lineup). side_a_player2 + side_b_player2 are already nullable
-- (singles), so dropping NOT NULL on the two player1 slots makes ALL four nullable.
--
-- Additive-safe: existing rows already have both player1 slots filled, so this only
-- WIDENS what's permitted. FK (REFERENCES club_players ON DELETE CASCADE) + indexes
-- are untouched by DROP NOT NULL. The club_match_player_guard trigger uses array
-- overlap (&&), which ignores NULLs, so empty slots never false-positive a busy-player
-- start. A pending match can never reach in_progress (and thus completed) while
-- incomplete — startClubMatchAction blocks it via isClubMatchFull — so finish/delete
-- RPCs still only ever see a fully-staffed match.
ALTER TABLE public.club_matches ALTER COLUMN side_a_player1 DROP NOT NULL;
ALTER TABLE public.club_matches ALTER COLUMN side_b_player1 DROP NOT NULL;
