-- Fix the unbounded guest-profile creation (core-review P2, route.ts:19): the
-- unauthenticated POST /api/auth/guest inserts a profiles row for any name>=2 with
-- no limit, so a script can bloat the table indefinitely.
--
-- Bound it with a global rate limit under an advisory lock: reject when >= 60 guest
-- profiles were created in the last minute. Global (not per-IP) on purpose — no IP
-- is captured or stored (no PII), and 60/min is far above any legitimate usage for
-- this app while stopping scripted thousands/min. Tunable via the literals below.
CREATE OR REPLACE FUNCTION public.create_guest_profile(p_display_name text)
RETURNS public.profiles LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_recent int; v_row public.profiles;
BEGIN
  -- Serialize the count→insert so the limit can't be overrun by a burst.
  PERFORM pg_advisory_xact_lock(hashtext('guest_signup'));
  SELECT count(*) INTO v_recent
    FROM public.profiles
    WHERE is_guest AND created_at > now() - interval '1 minute';
  IF v_recent >= 60 THEN
    RAISE EXCEPTION 'guest_rate_limit' USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO public.profiles (display_name, is_guest)
    VALUES (p_display_name, true)
    RETURNING * INTO v_row;
  RETURN v_row;
END $$;

REVOKE ALL ON FUNCTION public.create_guest_profile(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_guest_profile(text) TO service_role;
