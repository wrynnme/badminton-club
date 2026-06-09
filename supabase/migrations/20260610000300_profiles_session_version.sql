-- M3 — per-profile session revocation ("logout everywhere").
-- profiles.session_version is stamped into the bc_session cookie payload (`sv`)
-- at login; getSession() compares the token's sv with the live column value.
-- bump_session_version(+1) invalidates every previously minted token for that
-- profile (responds to a leaked cookie without rotating SESSION_SECRET).
-- Graceful rollout: tokens minted before this feature carry no `sv` → decode()
-- treats them as 0, which matches the column default → nobody is logged out.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS session_version int NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.bump_session_version(p_profile_id uuid)
RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
  UPDATE public.profiles SET session_version = session_version + 1 WHERE id = p_profile_id;
$$;
REVOKE ALL ON FUNCTION public.bump_session_version(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bump_session_version(uuid) TO service_role;
