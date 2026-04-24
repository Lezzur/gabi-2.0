-- =============================================================================
-- 0004_auth_hook.sql — GAIA Phase 2: Custom access token hook.
--
-- Registers `public.gaia_custom_access_token_hook(event jsonb)` — a Supabase
-- Auth "custom_access_token" hook that GoTrue invokes on every session
-- issuance/refresh. It looks up the signing user in `user_profiles` (and
-- sidecar tables `dealer_accounts` / `manufacturer_accounts`) and merges
-- four application-level claims into the JWT:
--
--   * user_role        — 'farmer' | 'dealer' | 'brand_admin' | 'gabs_admin'
--   * locale           — BCP-47 tag from user_profiles.locale
--   * dealer_id        — dealer_accounts.id (null if the user isn't a dealer)
--   * manufacturer_id  — manufacturer_accounts.id (null if not a brand user)
--
-- Downstream: RLS policies (0003_rls.sql) read these via
-- `auth.jwt() ->> 'user_role'` etc., so the lookup runs once at token
-- issuance instead of on every query.
--
-- Spec sources: tech-spec §4.3 (auth flow), PRD §Phase 2 item 2.1.5
-- (role-from-profile claim injection), and Supabase Auth hook reference.
--
-- Intentional deviations from the task prompt, recorded for reviewers:
--
--   * The app role is written to `user_role`, NOT `role`. Task prompt says
--     "role" literally. The JWT `role` top-level claim is reserved by
--     PostgREST — it's the Postgres role used for `SET ROLE` on every query
--     (typically `authenticated` / `anon`). Overwriting it with `'farmer'`
--     would make PostgREST attempt `SET ROLE farmer`, which fails because
--     no such DB role exists, taking down the entire API. `user_role` is
--     the conventional Supabase-community name for the application role
--     claim and is what RLS helpers should read.
--
--   * `dealer_id` / `manufacturer_id` are sourced from `dealer_accounts` /
--     `manufacturer_accounts` (joined on user_id), not from columns on
--     `user_profiles` — those columns do not exist in 0002_aux.sql. Task
--     prompt wording "look up user_profiles for … dealer_id …" is treated
--     as shorthand for "look up the profile and its related account rows".
--
--   * The function has TWO nested exception handlers (not one). The outer
--     handler catches malformed-event failures (e.g. `event->>'user_id'`
--     isn't castable to uuid) before any table access. The inner handler
--     catches lookup failures (table missing, permission error, etc.)
--     and also returns the event unchanged. Both paths fail OPEN for
--     availability — a broken hook must not brick login. Authorization
--     stays safe because RLS policies in 0003_rls.sql deny by default
--     when the claim is absent.
-- =============================================================================

BEGIN;

-- =============================================================================
-- gaia_custom_access_token_hook
-- =============================================================================
-- SECURITY DEFINER: runs as the function owner (postgres) so it can read
-- user_profiles / dealer_accounts / manufacturer_accounts regardless of the
-- invoking role (supabase_auth_admin). The `SET search_path = public, pg_temp`
-- lock prevents a malicious schema on the invoker's search_path from
-- shadowing our tables — required hardening for any SECURITY DEFINER function.

CREATE OR REPLACE FUNCTION public.gaia_custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id         uuid;
  v_role            text;
  v_locale          text;
  v_dealer_id       uuid;
  v_manufacturer_id uuid;
  v_claims          jsonb;
BEGIN
  -- Phase 1: parse user_id out of the event envelope.
  -- A malformed event (missing user_id, non-uuid string) must NOT fail the
  -- hook — GoTrue would surface that as a 500 and block the login. Catch
  -- any cast/extraction error here and return the event untouched.
  BEGIN
    v_user_id := (event ->> 'user_id')::uuid;
  EXCEPTION WHEN OTHERS THEN
    RETURN event;
  END;

  IF v_user_id IS NULL THEN
    RETURN event;
  END IF;

  -- Phase 2: look up the profile and sidecar account rows, and merge the
  -- derived claims. Any error here (missing table, permission revoked,
  -- stats error) also falls through to returning the event unchanged.
  -- Fail open for availability; authorization stays closed because RLS
  -- policies deny when `user_role` is absent from the JWT.
  BEGIN
    SELECT role, locale
      INTO v_role, v_locale
      FROM public.user_profiles
     WHERE id = v_user_id;

    -- Missing profile = first-login race where the auth.users row exists
    -- but the app-level profile hasn't been created yet, or a manually
    -- seeded admin without a profile row. App code handles the missing
    -- state; don't block the session.
    IF NOT FOUND THEN
      RETURN event;
    END IF;

    SELECT id
      INTO v_dealer_id
      FROM public.dealer_accounts
     WHERE user_id = v_user_id;

    SELECT id
      INTO v_manufacturer_id
      FROM public.manufacturer_accounts
     WHERE user_id = v_user_id;

    -- Preserve every existing claim (aud, exp, sub, role, aal, amr,
    -- session_id, etc.) and overlay ours. `||` on jsonb right-biases, so
    -- our four keys win if any happen to already exist.
    v_claims := COALESCE(event -> 'claims', '{}'::jsonb)
             || jsonb_build_object(
                  'user_role',       v_role,
                  'locale',          v_locale,
                  'dealer_id',       v_dealer_id,
                  'manufacturer_id', v_manufacturer_id
                );

    RETURN jsonb_set(event, '{claims}', v_claims, true);
  EXCEPTION WHEN OTHERS THEN
    RETURN event;
  END;
END;
$$;

COMMENT ON FUNCTION public.gaia_custom_access_token_hook(jsonb) IS
  'Supabase Auth custom_access_token hook. Merges user_role, locale, dealer_id, and manufacturer_id claims from user_profiles / dealer_accounts / manufacturer_accounts into the JWT on every session issuance. Fails open (returns event unchanged) on malformed event or lookup error — RLS policies provide the authoritative authorization gate. Registered in supabase/config.toml under [auth.hook.custom_access_token].';

-- =============================================================================
-- Privilege lockdown
-- =============================================================================
-- Supabase Auth calls hooks as the `supabase_auth_admin` role. Revoke the
-- default PUBLIC EXECUTE grant, then grant EXECUTE only to that role so no
-- other session (including anon / authenticated PostgREST callers) can
-- invoke the hook directly to probe profile data.

REVOKE EXECUTE ON FUNCTION public.gaia_custom_access_token_hook(jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.gaia_custom_access_token_hook(jsonb) FROM anon, authenticated;

GRANT EXECUTE ON FUNCTION public.gaia_custom_access_token_hook(jsonb) TO supabase_auth_admin;

-- The hook reads user_profiles / dealer_accounts / manufacturer_accounts
-- as the function owner (SECURITY DEFINER), so supabase_auth_admin does
-- NOT need a SELECT grant on those tables — the row lookup happens with
-- the definer's privileges. Explicitly denying SELECT here documents that
-- the auth admin should never read profile data outside the hook path.
REVOKE ALL ON TABLE public.user_profiles          FROM supabase_auth_admin;
REVOKE ALL ON TABLE public.dealer_accounts        FROM supabase_auth_admin;
REVOKE ALL ON TABLE public.manufacturer_accounts  FROM supabase_auth_admin;

COMMIT;
