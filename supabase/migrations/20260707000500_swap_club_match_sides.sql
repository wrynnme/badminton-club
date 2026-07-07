-- Atomic side-for-side swap between two PENDING club matches, used by the
-- "จัดคิวใหม่" (re-roll) fallback when the whole roster is already queued and there
-- are no free players to rotate in (see rebuildClubPendingMatchAction /
-- planRerollSwap). Swapping one whole side each gives both matches a fresh matchup
-- while every player keeps exactly their one game, and never splits a locked pair
-- (a locked pair always occupies one entire side).
--
-- Doing it in one RPC (row-locked) keeps it atomic: two sequential UPDATEs from the
-- action could leave a player booked in both matches if the second failed. The
-- function also refuses any swap that would put a player on both sides of either
-- match (defence in depth — the planner already excludes that case).
--
-- service_role-only, mirroring the other club-match RPCs.

CREATE OR REPLACE FUNCTION public.swap_club_match_sides(
  p_m1 uuid,
  p_slot1 text,
  p_m2 uuid,
  p_slot2 text
) RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  m1 public.club_matches;
  m2 public.club_matches;
  s1p1 uuid; s1p2 uuid;   -- m1's swapped side (slot1)
  s2p1 uuid; s2p2 uuid;   -- m2's swapped side (slot2)
  o1p1 uuid; o1p2 uuid;   -- m1's other (kept) side
  o2p1 uuid; o2p2 uuid;   -- m2's other (kept) side
BEGIN
  IF p_m1 = p_m2 THEN
    RAISE EXCEPTION 'club_swap_same_match' USING ERRCODE = 'P0001';
  END IF;
  IF p_slot1 NOT IN ('a','b') OR p_slot2 NOT IN ('a','b') THEN
    RAISE EXCEPTION 'club_swap_bad_slot' USING ERRCODE = 'P0001';
  END IF;

  -- Lock both rows in a deterministic order (by id) to avoid deadlocks.
  IF p_m1 < p_m2 THEN
    SELECT * INTO m1 FROM public.club_matches WHERE id = p_m1 FOR UPDATE;
    SELECT * INTO m2 FROM public.club_matches WHERE id = p_m2 FOR UPDATE;
  ELSE
    SELECT * INTO m2 FROM public.club_matches WHERE id = p_m2 FOR UPDATE;
    SELECT * INTO m1 FROM public.club_matches WHERE id = p_m1 FOR UPDATE;
  END IF;

  IF m1.id IS NULL OR m2.id IS NULL THEN
    RAISE EXCEPTION 'club_swap_not_found' USING ERRCODE = 'P0001';
  END IF;
  IF m1.club_id <> m2.club_id THEN
    RAISE EXCEPTION 'club_swap_cross_club' USING ERRCODE = 'P0001';
  END IF;
  IF m1.status <> 'pending' OR m2.status <> 'pending' THEN
    RAISE EXCEPTION 'club_swap_not_pending' USING ERRCODE = 'P0001';
  END IF;

  IF p_slot1 = 'a' THEN
    s1p1 := m1.side_a_player1; s1p2 := m1.side_a_player2;
    o1p1 := m1.side_b_player1; o1p2 := m1.side_b_player2;
  ELSE
    s1p1 := m1.side_b_player1; s1p2 := m1.side_b_player2;
    o1p1 := m1.side_a_player1; o1p2 := m1.side_a_player2;
  END IF;
  IF p_slot2 = 'a' THEN
    s2p1 := m2.side_a_player1; s2p2 := m2.side_a_player2;
    o2p1 := m2.side_b_player1; o2p2 := m2.side_b_player2;
  ELSE
    s2p1 := m2.side_b_player1; s2p2 := m2.side_b_player2;
    o2p1 := m2.side_a_player1; o2p2 := m2.side_a_player2;
  END IF;

  -- Refuse a swap that would put a player on both sides of either match: the
  -- incoming side must be disjoint from the side that stays put.
  IF (s2p1 IS NOT NULL AND (s2p1 = o1p1 OR s2p1 = o1p2))
   OR (s2p2 IS NOT NULL AND (s2p2 = o1p1 OR s2p2 = o1p2))
   OR (s1p1 IS NOT NULL AND (s1p1 = o2p1 OR s1p1 = o2p2))
   OR (s1p2 IS NOT NULL AND (s1p2 = o2p1 OR s1p2 = o2p2)) THEN
    RAISE EXCEPTION 'club_swap_would_double_book' USING ERRCODE = 'P0001';
  END IF;

  -- m1's swapped side receives m2's players, and vice-versa.
  IF p_slot1 = 'a' THEN
    UPDATE public.club_matches SET side_a_player1 = s2p1, side_a_player2 = s2p2 WHERE id = p_m1;
  ELSE
    UPDATE public.club_matches SET side_b_player1 = s2p1, side_b_player2 = s2p2 WHERE id = p_m1;
  END IF;
  IF p_slot2 = 'a' THEN
    UPDATE public.club_matches SET side_a_player1 = s1p1, side_a_player2 = s1p2 WHERE id = p_m2;
  ELSE
    UPDATE public.club_matches SET side_b_player1 = s1p1, side_b_player2 = s1p2 WHERE id = p_m2;
  END IF;
END;
$$;

-- service_role-only, like every other club-match RPC. anon/authenticated get a
-- default-privilege EXECUTE grant on new public functions in this project, so
-- REVOKE FROM PUBLIC alone leaves them able to call it — revoke them explicitly.
REVOKE EXECUTE ON FUNCTION public.swap_club_match_sides(uuid, text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.swap_club_match_sides(uuid, text, uuid, text) TO service_role;
