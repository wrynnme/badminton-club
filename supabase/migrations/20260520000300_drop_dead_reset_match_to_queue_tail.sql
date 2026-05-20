-- P2-A cleanup: drop dead RPC superseded by reset_match_score.
-- reset_match_to_queue_tail was created alongside cancel/create_manual in
-- migration 20260520000100, but reset_match_score (000200) handles the full
-- atomic cascade (slot clear + queue position + status flip) for all callers.
-- No TS code path calls reset_match_to_queue_tail.
DROP FUNCTION IF EXISTS public.reset_match_to_queue_tail(uuid, uuid);
