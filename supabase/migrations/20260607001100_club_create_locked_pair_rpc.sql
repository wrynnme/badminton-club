-- Atomic locked-pair creation. The app-layer "neither player already locked" check
-- in createClubLockedPairAction was a read-then-insert TOCTOU: two concurrent
-- requests locking the same player both passed the check and inserted, leaving a
-- player in two active locks (buildNextMatch's partnerOf map then silently drops one).
-- This RPC takes a club-row lock so concurrent lock creation for the same club
-- serializes, then re-checks under the lock before inserting.
CREATE OR REPLACE FUNCTION public.create_club_locked_pair(
  p_club_id uuid,
  p_player1 uuid,
  p_player2 uuid,
  p_games integer DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  v_id uuid;
BEGIN
  -- Serialize concurrent lock creation for this club (closes the TOCTOU window).
  PERFORM 1 FROM public.clubs WHERE id = p_club_id FOR UPDATE;

  IF EXISTS (
    SELECT 1 FROM public.club_locked_pairs
    WHERE club_id = p_club_id
      AND (player1_id IN (p_player1, p_player2) OR player2_id IN (p_player1, p_player2))
  ) THEN
    RAISE EXCEPTION 'player_already_locked';
  END IF;

  INSERT INTO public.club_locked_pairs (club_id, player1_id, player2_id, games_remaining)
  VALUES (p_club_id, p_player1, p_player2, p_games)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;
