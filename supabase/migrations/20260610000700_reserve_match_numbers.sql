-- Fix the class match_number collision race (core-review P2, classes.ts:544):
-- the 3 class generate actions read max(match_number)+1 then bulk-insert; two
-- concurrent generations in the same tournament read the same max and assign
-- overlapping match_numbers.
--
-- Atomic durable reservation via a per-tournament counter. A single UPDATE bumps
-- match_number_hwm under the tournaments row lock (serializes concurrent reservers)
-- and returns the base; callers assign match_number = base+1 .. base+count, then do
-- a normal insert (DB column defaults preserved — no jsonb_populate). GREATEST with
-- the live max keeps the counter correct after a sports_day→competition upgrade and
-- on first use.
ALTER TABLE public.tournaments ADD COLUMN IF NOT EXISTS match_number_hwm int NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.reserve_match_numbers(p_tournament_id uuid, p_count int)
RETURNS int LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_base int;
BEGIN
  IF p_count <= 0 THEN RAISE EXCEPTION 'p_count must be > 0'; END IF;
  UPDATE public.tournaments
    SET match_number_hwm = GREATEST(
          match_number_hwm,
          COALESCE((SELECT max(match_number) FROM public.matches WHERE tournament_id = p_tournament_id), 0)
        ) + p_count
    WHERE id = p_tournament_id
    RETURNING match_number_hwm - p_count INTO v_base;
  IF v_base IS NULL THEN RAISE EXCEPTION 'tournament not found: %', p_tournament_id; END IF;
  RETURN v_base; -- assign match_number = v_base + 1 .. v_base + p_count
END $$;

REVOKE ALL ON FUNCTION public.reserve_match_numbers(uuid,int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_match_numbers(uuid,int) TO service_role;
