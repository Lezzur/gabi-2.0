-- =============================================================================
-- 0014_fix_role_claim.sql — fall back to app_metadata when hook is absent.
--
-- Without the custom access token hook registered in the Supabase cloud
-- dashboard, `user_role` lives only inside the `app_metadata` object in the
-- JWT, not at the top level. `auth.jwt() ->> 'user_role'` returns NULL,
-- causing every RLS policy to deny access.
--
-- Fix: read from all three locations in order of priority:
--   1. top-level `user_role` (present when hook IS registered)
--   2. app_metadata.user_role  (set via Admin API on app_metadata)
--   3. app_metadata.role       (fallback alias used during setup)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.app_user_role()
RETURNS text
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(
    auth.jwt() ->> 'user_role',
    auth.jwt() -> 'app_metadata' ->> 'user_role',
    auth.jwt() -> 'app_metadata' ->> 'role'
  );
$$;
