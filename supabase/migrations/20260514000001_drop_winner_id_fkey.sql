-- Drop winner_id FK so pair mode can store pair UUIDs as winner_id
-- Originally referenced teams(id) only, blocking pair mode score recording
ALTER TABLE matches DROP CONSTRAINT IF EXISTS matches_winner_id_fkey;
