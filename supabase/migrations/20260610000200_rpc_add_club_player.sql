-- M2 — atomic club-player insert with capacity check under a club-row lock.
-- Closes the read-then-insert race in addGuestPlayerAction (clubs.ts): two
-- concurrent adds at the cap both counted active < max_players and both inserted
-- as 'active', overshooting the cap. FOR UPDATE on the clubs row serializes
-- concurrent adds; the active count + status decision + insert happen in one
-- transaction. position = total+1 mirrors the old JS behavior exactly.
CREATE OR REPLACE FUNCTION public.add_club_player(
  p_club_id uuid, p_display_name text, p_level_id uuid, p_note text
) RETURNS public.club_players LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE v_max int; v_active int; v_total int; v_status text; v_row public.club_players;
BEGIN
  SELECT max_players INTO v_max FROM public.clubs WHERE id=p_club_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'club not found: %', p_club_id; END IF;
  SELECT count(*) FILTER (WHERE status='active'), count(*) INTO v_active, v_total
    FROM public.club_players WHERE club_id=p_club_id;
  v_status := CASE WHEN v_active >= v_max THEN 'reserve' ELSE 'active' END;
  INSERT INTO public.club_players (club_id, profile_id, display_name, level_id, note, position, status)
    VALUES (p_club_id, NULL, p_display_name, p_level_id, p_note, v_total+1, v_status) RETURNING * INTO v_row;
  RETURN v_row;
END; $$;
REVOKE ALL ON FUNCTION public.add_club_player(uuid,text,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.add_club_player(uuid,text,uuid,text) TO service_role;
