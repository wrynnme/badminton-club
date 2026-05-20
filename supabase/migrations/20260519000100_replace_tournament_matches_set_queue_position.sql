-- B3 fix — replace_tournament_matches now seeds queue_position from match_number
-- so autoRotateQueueAction and reorder DnD have slots to rearrange.

CREATE OR REPLACE FUNCTION public.replace_tournament_matches(
  p_tournament_id uuid,
  p_round_type text,
  p_matches jsonb
) RETURNS int
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
declare
  v_count int;
begin
  if p_round_type not in ('group','knockout') then
    raise exception 'invalid_round_type';
  end if;

  delete from public.matches
  where tournament_id = p_tournament_id
    and round_type = p_round_type;

  if p_matches is null or jsonb_typeof(p_matches) <> 'array' or jsonb_array_length(p_matches) = 0 then
    return 0;
  end if;

  insert into public.matches (
    id, tournament_id, round_type, round_number, match_number,
    team_a_id, team_b_id, pair_a_id, pair_b_id,
    next_match_id, next_match_slot, loser_next_match_id, loser_next_match_slot,
    bracket, status, games, group_id, division,
    queue_position
  )
  select
    coalesce(nullif(r->>'id','')::uuid, gen_random_uuid()),
    p_tournament_id,
    p_round_type,
    coalesce(nullif(r->>'round_number','')::int, 1),
    (r->>'match_number')::int,
    nullif(r->>'team_a_id','')::uuid,
    nullif(r->>'team_b_id','')::uuid,
    nullif(r->>'pair_a_id','')::uuid,
    nullif(r->>'pair_b_id','')::uuid,
    nullif(r->>'next_match_id','')::uuid,
    nullif(r->>'next_match_slot',''),
    nullif(r->>'loser_next_match_id','')::uuid,
    nullif(r->>'loser_next_match_slot',''),
    coalesce(nullif(r->>'bracket',''), 'upper'),
    coalesce(nullif(r->>'status',''), 'pending'),
    coalesce(r->'games', '[]'::jsonb),
    nullif(r->>'group_id','')::uuid,
    nullif(r->>'division',''),
    coalesce(nullif(r->>'queue_position','')::int, (r->>'match_number')::int)
  from jsonb_array_elements(p_matches) r;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
