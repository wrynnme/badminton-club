-- Winner forward-pointer for club batch queue ("ผู้ชนะจากแมตช์ #N"), mirroring
-- the tournament pattern (matches.next_match_id / next_match_slot): the pointer
-- lives on the FEEDER row; when the feeder completes with a winner,
-- finish_club_match copies the winning side's player ids into the target
-- match's side slots (see 20260707000300).
--
-- Deliberately NO paired-null CHECK ((id IS NULL) = (slot IS NULL)):
-- ON DELETE SET NULL nulls only the FK column, which would violate such a
-- CHECK and make target-match deletion fail. A dangling slot value is
-- harmless — app code treats the pointer as active only when
-- winner_next_match_id IS NOT NULL.
ALTER TABLE public.club_matches
  ADD COLUMN IF NOT EXISTS winner_next_match_id uuid
    REFERENCES public.club_matches(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS winner_next_match_slot text
    CHECK (winner_next_match_slot IN ('a','b'));

CREATE INDEX IF NOT EXISTS idx_club_matches_winner_next
  ON public.club_matches (winner_next_match_id);
