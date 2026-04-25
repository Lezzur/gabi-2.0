-- =============================================================================
-- 0003_rls.sql — GAIA Phase 2: Row-Level Security on every public table.
--
-- Enables RLS on every table created in 0001_init.sql / 0002_aux.sql, then
-- declares per-verb policies that enforce the role / identity matrix from
-- PRD §Phase 2 items 6–24 and tech-spec §6 (Authorization). RLS is the
-- authoritative gate for client-side queries (anon, authenticated);
-- service_role bypasses RLS by design and is reserved for API routes that
-- need to write across owners (atomic claim, reward crediting, FPA upserts).
--
-- Hardening (per task prompt + Supabase performance guidance):
--   * The JWT claim string lives in one STABLE helper per claim
--     (`app_user_role`, `app_user_dealer_id`, `app_user_manufacturer_id`);
--     policies call them via `(select helper())` so the planner hoists the
--     call out of per-row evaluation.
--   * `(select auth.uid())` is wrapped the same way for the same reason.
--   * Schema-level CREATE on `public` is revoked from anon / authenticated
--     (USAGE only), default Supabase table grants are revoked, and SELECT is
--     re-granted to authenticated. INSERT / UPDATE / DELETE are not granted
--     to any client role anywhere in this migration — every write path is
--     service_role. RLS policies are still declared as defense-in-depth so
--     a future migration that GRANTs a verb cannot accidentally open a row.
--   * `pending_purchase` / `pending_return_reward` enable RLS but declare
--     zero policies, which means every verb is denied for non-service-role
--     callers. Rationale: PRD §Phase 2 item 16 ("All access: service role
--     only").
--   * `ALTER DEFAULT PRIVILEGES` mirrors the explicit grants so future
--     tables created in `public` by the migration role inherit the same
--     authenticated-SELECT-only / service_role-ALL perimeter.
--
-- Spec sources: PRD §Phase 2 items 6–24, tech-spec §6 (Security
-- Considerations), Supabase RLS performance docs (the `(select fn())` wrap).
--
-- Intentional deviations from the task prompt, recorded for reviewers:
--
--   * The role claim is `user_role`, NOT `role`. The auth hook
--     (0004_auth_hook.sql) deliberately writes `user_role` because the JWT
--     `role` top-level claim is reserved by PostgREST for the Postgres role
--     used in `SET ROLE` (see 0004 header for the rationale). Reading
--     `auth.jwt() ->> 'role'` here would always resolve to `'authenticated'`
--     / `'anon'` and break every policy. The helpers exist precisely so
--     this string is in one place if it ever changes again.
--
--   * `products.brand_admin` policy: brand_admin reads ALL products, not
--     "own manufacturer's only", because the `products` table has no
--     manufacturer_id FK — its provenance fields (`company`, `formulated_by`,
--     `imported_by`) are free text. PRD §Phase 2 item 6 itself says
--     brand_admin reads all, which the task prompt overrides without a
--     supporting schema. Per-manufacturer scoping requires a future schema
--     amendment (e.g. `products.manufacturer_id uuid REFERENCES
--     manufacturer_accounts(id)`) before the policy can be tightened.
--
--   * `products` / `product_crops` non-admin policy: dealers AND farmers
--     see only `status = 'active'`, per PRD §Phase 2 item 6. Task prompt
--     says "dealers read all" — overridden in favor of PRD because dealers
--     should not see in-progress draft products that haven't cleared the
--     OCR safety gate (tech-spec §6).
--
--   * `containers` dealer scoping: PRD §Phase 2 item 11 phrases the rule
--     as "dealer_id = auth.uid()", but `containers.dealer_id` is FK to
--     `dealer_accounts.id`, NOT auth.users.id. The comparison is against
--     the JWT `dealer_id` claim (= dealer_accounts.id, populated by the
--     auth hook). PRD wording is treated as shorthand for "the dealer's
--     own row".
--
--   * `scan_attempts`: no INSERT policy. Task prompt says "only INSERT is
--     permitted" — interpreted as "INSERT is the only verb that is not
--     explicitly blocked twice"; in practice service_role bypasses RLS for
--     the authoritative INSERT path (PRD item 13: "via service role in API
--     routes only"), and authenticated has no INSERT grant. UPDATE /
--     DELETE are blocked by the trigger declared in 0001_init.sql, which
--     fires for every role including service_role (the load-bearing
--     append-only enforcement). RLS is the redundant gate here.
-- =============================================================================

BEGIN;

-- =============================================================================
-- JWT-claim helpers (STABLE so the planner hoists them out of per-row eval).
-- =============================================================================
-- Every policy in this file goes through these helpers instead of inlining
-- the claim-key string. Two reasons:
--   * If the JWT key changes (e.g. role → user_role swap, see 0004 header),
--     the fix is one line, not N policies.
--   * `STABLE` plus the `(select fn())` wrap is the documented Supabase
--     pattern for hoisting auth.* lookups out of seq-scan filter execution.
-- SECURITY INVOKER is the default and is correct here — the helper reads
-- only the caller's own JWT, not other rows.

CREATE OR REPLACE FUNCTION public.app_user_role()
RETURNS text
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT auth.jwt() ->> 'user_role';
$$;

COMMENT ON FUNCTION public.app_user_role() IS
  'Returns the application role claim (`user_role`) from the current JWT, or NULL when no JWT is bound (anon, service_role, supabase_auth_admin). Wrap as `(select app_user_role())` in policies so the planner hoists the call.';

CREATE OR REPLACE FUNCTION public.app_user_dealer_id()
RETURNS uuid
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT NULLIF(auth.jwt() ->> 'dealer_id', '')::uuid;
$$;

COMMENT ON FUNCTION public.app_user_dealer_id() IS
  'Returns the JWT `dealer_id` claim (= dealer_accounts.id) for dealer users, NULL otherwise. NULLIF guards a literal empty-string claim before the uuid cast.';

CREATE OR REPLACE FUNCTION public.app_user_manufacturer_id()
RETURNS uuid
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT NULLIF(auth.jwt() ->> 'manufacturer_id', '')::uuid;
$$;

COMMENT ON FUNCTION public.app_user_manufacturer_id() IS
  'Returns the JWT `manufacturer_id` claim (= manufacturer_accounts.id) for brand_admin users, NULL otherwise.';

-- Lock helper exec to client / service roles. Anon CAN call them (returns
-- NULL) but does not need to, and policies are short-circuited for anon by
-- the `TO authenticated` clause anyway.
REVOKE ALL ON FUNCTION public.app_user_role()            FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_user_dealer_id()       FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_user_manufacturer_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_user_role()            TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.app_user_dealer_id()       TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.app_user_manufacturer_id() TO authenticated, service_role;

-- =============================================================================
-- Enable RLS on every public table (no exceptions per PRD §Phase 2).
-- =============================================================================
ALTER TABLE public.products              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_crops         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.containers            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scan_attempts         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_profiles         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dealer_accounts       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.manufacturer_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pending_purchase      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pending_return_reward ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallets               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_transactions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vouchers              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reward_config         ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- products
-- =============================================================================

CREATE POLICY products_select_admin
  ON public.products
  FOR SELECT
  TO authenticated
  USING ((select app_user_role()) IN ('gabs_admin', 'brand_admin'));

COMMENT ON POLICY products_select_admin ON public.products IS
  'gabs_admin and brand_admin read every product row (any status). PRD §Phase 2 item 6. brand_admin is not scoped per-manufacturer because products has no manufacturer_id FK; see header for the deviation note.';

CREATE POLICY products_select_active
  ON public.products
  FOR SELECT
  TO authenticated
  USING (
    status = 'active'
    AND (select app_user_role()) IN ('dealer', 'farmer')
  );

COMMENT ON POLICY products_select_active ON public.products IS
  'Dealers and farmers read only active products. PRD §Phase 2 item 6. Drafts must not leak (have not cleared the OCR safety gate, tech-spec §6); suspended is the terminal state for withdrawn products.';

CREATE POLICY products_insert_admin
  ON public.products
  FOR INSERT
  TO authenticated
  WITH CHECK ((select app_user_role()) = 'gabs_admin');

COMMENT ON POLICY products_insert_admin ON public.products IS
  'Only gabs_admin can insert products. PRD §Phase 2 item 7. The FPA-import path uses service_role and bypasses RLS; this policy covers the CRM admin UI fallback.';

CREATE POLICY products_update_admin
  ON public.products
  FOR UPDATE
  TO authenticated
  USING ((select app_user_role()) = 'gabs_admin')
  WITH CHECK ((select app_user_role()) = 'gabs_admin');

COMMENT ON POLICY products_update_admin ON public.products IS
  'Only gabs_admin updates products. PRD §Phase 2 item 7. CRM safety-gate edits (category, note_to_physician confirmations) ride this policy.';

-- DELETE: no policy → denied. PRD §Phase 2 item 8 ("Disallowed for all roles").

-- =============================================================================
-- product_crops — visibility mirrors parent products (PRD §Phase 2 item 9).
-- =============================================================================

CREATE POLICY product_crops_select_admin
  ON public.product_crops
  FOR SELECT
  TO authenticated
  USING ((select app_user_role()) IN ('gabs_admin', 'brand_admin'));

COMMENT ON POLICY product_crops_select_admin ON public.product_crops IS
  'gabs_admin and brand_admin read every crop row. Mirrors products_select_admin.';

CREATE POLICY product_crops_select_active
  ON public.product_crops
  FOR SELECT
  TO authenticated
  USING (
    (select app_user_role()) IN ('dealer', 'farmer')
    AND EXISTS (
      SELECT 1
        FROM public.products p
       WHERE p.id = product_crops.product_id
         AND p.status = 'active'
    )
  );

COMMENT ON POLICY product_crops_select_active ON public.product_crops IS
  'Dealers and farmers read crop rows only when the parent product is active. PRD §Phase 2 items 9 + 6. The EXISTS subquery enforces the same gate even if a draft accidentally has crop rows linked.';

CREATE POLICY product_crops_insert_admin
  ON public.product_crops
  FOR INSERT
  TO authenticated
  WITH CHECK ((select app_user_role()) = 'gabs_admin');

COMMENT ON POLICY product_crops_insert_admin ON public.product_crops IS
  'Only gabs_admin can insert crop rows. PRD §Phase 2 item 10.';

CREATE POLICY product_crops_update_admin
  ON public.product_crops
  FOR UPDATE
  TO authenticated
  USING ((select app_user_role()) = 'gabs_admin')
  WITH CHECK ((select app_user_role()) = 'gabs_admin');

COMMENT ON POLICY product_crops_update_admin ON public.product_crops IS
  'Only gabs_admin updates crop rows. PRD §Phase 2 item 10.';

-- =============================================================================
-- containers
-- =============================================================================
-- Visibility (PRD §Phase 2 item 11):
--   gabs_admin: every row
--   dealer:     dealer_id OR return_dealer_id matches the JWT dealer_id
--   farmer:     purchased_by_user_id OR returned_by_user_id matches auth.uid()
-- All writes go through service-role API routes (PRD item 12); no client
-- INSERT / UPDATE / DELETE policies are declared.

CREATE POLICY containers_select_admin
  ON public.containers
  FOR SELECT
  TO authenticated
  USING ((select app_user_role()) = 'gabs_admin');

COMMENT ON POLICY containers_select_admin ON public.containers IS
  'gabs_admin reads every container. PRD §Phase 2 item 11.';

CREATE POLICY containers_select_dealer
  ON public.containers
  FOR SELECT
  TO authenticated
  USING (
    (select app_user_role()) = 'dealer'
    AND (
      dealer_id        = (select app_user_dealer_id())
      OR return_dealer_id = (select app_user_dealer_id())
    )
  );

COMMENT ON POLICY containers_select_dealer ON public.containers IS
  'Dealers see only containers they sold (dealer_id) or accepted as returns (return_dealer_id). PRD §Phase 2 item 11. Compared against the JWT `dealer_id` claim (= dealer_accounts.id, populated by the auth hook in 0004_auth_hook.sql).';

CREATE POLICY containers_select_farmer
  ON public.containers
  FOR SELECT
  TO authenticated
  USING (
    (select app_user_role()) = 'farmer'
    AND (
      purchased_by_user_id = (select auth.uid())
      OR returned_by_user_id = (select auth.uid())
    )
  );

COMMENT ON POLICY containers_select_farmer ON public.containers IS
  'Farmers see only containers they purchased or returned. PRD §Phase 2 item 11.';

-- INSERT / UPDATE / DELETE: no policies → all denied for client roles. PRD
-- §Phase 2 item 12 ("Server-side only via service role key"). Service_role
-- bypasses RLS for the authoritative atomic-claim path (tech-spec §6 threat
-- model item 3).

-- =============================================================================
-- scan_attempts — append-only audit log
-- =============================================================================
-- UPDATE / DELETE are blocked by the trigger in 0001_init.sql for every
-- role including service_role (the trigger fires regardless of bypassrls —
-- that is the load-bearing append-only enforcement). RLS here is the
-- redundant gate for non-service-role callers, plus row-level visibility
-- on SELECT. INSERT happens via service_role only (PRD §Phase 2 item 13).

CREATE POLICY scan_attempts_select_admin
  ON public.scan_attempts
  FOR SELECT
  TO authenticated
  USING ((select app_user_role()) = 'gabs_admin');

COMMENT ON POLICY scan_attempts_select_admin ON public.scan_attempts IS
  'gabs_admin reads every scan attempt for forensic review. PRD §Phase 2 item 14.';

CREATE POLICY scan_attempts_select_self
  ON public.scan_attempts
  FOR SELECT
  TO authenticated
  USING (
    (select app_user_role()) IN ('farmer', 'dealer', 'brand_admin')
    AND actor_id = (select auth.uid())
  );

COMMENT ON POLICY scan_attempts_select_self ON public.scan_attempts IS
  'Non-admin authenticated users read only their own scan attempts (actor_id = auth.uid()). PRD §Phase 2 item 14. brand_admin is included for the brand portal scan-history view.';

-- INSERT / UPDATE / DELETE: no policies → all denied for client roles.
-- Trigger in 0001_init.sql blocks UPDATE/DELETE even for service_role
-- (defense in depth; PRD §Phase 2 item 15: "No role. Ever.").

-- =============================================================================
-- user_profiles
-- =============================================================================
-- One row per auth.users identity. PRD §Phase 2 doesn't enumerate explicit
-- policies for user_profiles, but the auth hook's role-claim path makes the
-- table sensitive: a self-update that flips `role` would be a privilege
-- escalation (tech-spec §6 threat model item 5). The simplest safe model:
-- self-read + admin-update only. App-level profile edits (display_name,
-- locale) flow through service-role API routes, same as every other write.

CREATE POLICY user_profiles_select_self
  ON public.user_profiles
  FOR SELECT
  TO authenticated
  USING (id = (select auth.uid()));

COMMENT ON POLICY user_profiles_select_self ON public.user_profiles IS
  'Every authenticated user reads their own profile row. The auth hook reads via SECURITY DEFINER and is unaffected by this policy.';

CREATE POLICY user_profiles_select_admin
  ON public.user_profiles
  FOR SELECT
  TO authenticated
  USING ((select app_user_role()) = 'gabs_admin');

COMMENT ON POLICY user_profiles_select_admin ON public.user_profiles IS
  'gabs_admin reads every profile for CRM user-management views.';

CREATE POLICY user_profiles_update_admin
  ON public.user_profiles
  FOR UPDATE
  TO authenticated
  USING ((select app_user_role()) = 'gabs_admin')
  WITH CHECK ((select app_user_role()) = 'gabs_admin');

COMMENT ON POLICY user_profiles_update_admin ON public.user_profiles IS
  'Only gabs_admin updates profiles via the client path. Role elevation (farmer → dealer / brand_admin / gabs_admin) is the protected operation here. Self-edit of display_name / locale flows through a service-role API route.';

-- INSERT: no policy → denied. The new-user trigger creates the row with
-- elevated privilege (declared in a follow-up migration); service_role
-- bypasses RLS for any backfill needs.
-- DELETE: no policy → denied. Profiles outlive auth.users (FK ON DELETE
-- RESTRICT in 0002_aux.sql).

-- =============================================================================
-- dealer_accounts (PRD §Phase 2 items 17–18)
-- =============================================================================

CREATE POLICY dealer_accounts_select_admin
  ON public.dealer_accounts
  FOR SELECT
  TO authenticated
  USING ((select app_user_role()) = 'gabs_admin');

COMMENT ON POLICY dealer_accounts_select_admin ON public.dealer_accounts IS
  'gabs_admin reads every dealer record. PRD §Phase 2 item 17.';

CREATE POLICY dealer_accounts_select_self
  ON public.dealer_accounts
  FOR SELECT
  TO authenticated
  USING (
    (select app_user_role()) = 'dealer'
    AND user_id = (select auth.uid())
  );

COMMENT ON POLICY dealer_accounts_select_self ON public.dealer_accounts IS
  'Dealers read only their own account row. Farmers and brand_admins cannot see dealer data. PRD §Phase 2 item 17.';

CREATE POLICY dealer_accounts_insert_admin
  ON public.dealer_accounts
  FOR INSERT
  TO authenticated
  WITH CHECK ((select app_user_role()) = 'gabs_admin');

COMMENT ON POLICY dealer_accounts_insert_admin ON public.dealer_accounts IS
  'Only gabs_admin creates dealer accounts (KYC sign-off path). PRD §Phase 2 item 18.';

CREATE POLICY dealer_accounts_update_admin
  ON public.dealer_accounts
  FOR UPDATE
  TO authenticated
  USING ((select app_user_role()) = 'gabs_admin')
  WITH CHECK ((select app_user_role()) = 'gabs_admin');

COMMENT ON POLICY dealer_accounts_update_admin ON public.dealer_accounts IS
  'Only gabs_admin updates dealer accounts (verify, deactivate). PRD §Phase 2 item 18.';

-- =============================================================================
-- manufacturer_accounts — same shape as dealer_accounts.
-- =============================================================================
-- Not enumerated in PRD §Phase 2; mirroring dealer_accounts is the
-- consistent extrapolation (sidecar identity table for a privileged role).

CREATE POLICY manufacturer_accounts_select_admin
  ON public.manufacturer_accounts
  FOR SELECT
  TO authenticated
  USING ((select app_user_role()) = 'gabs_admin');

COMMENT ON POLICY manufacturer_accounts_select_admin ON public.manufacturer_accounts IS
  'gabs_admin reads every manufacturer record.';

CREATE POLICY manufacturer_accounts_select_self
  ON public.manufacturer_accounts
  FOR SELECT
  TO authenticated
  USING (
    (select app_user_role()) = 'brand_admin'
    AND user_id = (select auth.uid())
  );

COMMENT ON POLICY manufacturer_accounts_select_self ON public.manufacturer_accounts IS
  'brand_admin reads only their own manufacturer row.';

CREATE POLICY manufacturer_accounts_insert_admin
  ON public.manufacturer_accounts
  FOR INSERT
  TO authenticated
  WITH CHECK ((select app_user_role()) = 'gabs_admin');

COMMENT ON POLICY manufacturer_accounts_insert_admin ON public.manufacturer_accounts IS
  'Only gabs_admin creates manufacturer accounts (no public sign-up path).';

CREATE POLICY manufacturer_accounts_update_admin
  ON public.manufacturer_accounts
  FOR UPDATE
  TO authenticated
  USING ((select app_user_role()) = 'gabs_admin')
  WITH CHECK ((select app_user_role()) = 'gabs_admin');

COMMENT ON POLICY manufacturer_accounts_update_admin ON public.manufacturer_accounts IS
  'Only gabs_admin updates manufacturer accounts.';

-- =============================================================================
-- pending_purchase / pending_return_reward — service_role only
-- =============================================================================
-- "All access: service role only. No client reads or writes." PRD §Phase 2
-- item 16. RLS is enabled above; declaring zero policies denies every verb
-- for non-service-role callers. Service_role bypasses RLS and remains the
-- sole writer (atomic-claim path, tech-spec §6 threat model item 3).
--
-- These tables intentionally have no `CREATE POLICY` statements. Any future
-- migration that wants to add one must justify it against PRD §Phase 2 item
-- 16 in the migration header.

-- =============================================================================
-- wallets (PRD §Phase 2 items 19–20)
-- =============================================================================

CREATE POLICY wallets_select_self
  ON public.wallets
  FOR SELECT
  TO authenticated
  USING (user_id = (select auth.uid()));

COMMENT ON POLICY wallets_select_self ON public.wallets IS
  'A user reads only their own wallet. PRD §Phase 2 item 19. Mobile profile screen and CRM dealer wallet panel both rely on this.';

CREATE POLICY wallets_select_admin
  ON public.wallets
  FOR SELECT
  TO authenticated
  USING ((select app_user_role()) = 'gabs_admin');

COMMENT ON POLICY wallets_select_admin ON public.wallets IS
  'gabs_admin reads every wallet for points-administration views. PRD §Phase 2 item 19.';

-- INSERT / UPDATE / DELETE: no policies → denied for client roles. Wallet
-- creation runs in the new-user trigger; balance updates run in the scan
-- API (service_role, atomic against `balance_points >= 0`). PRD §Phase 2
-- item 20 ("Service role only").

-- =============================================================================
-- wallet_transactions — append-only ledger (PRD §Phase 2 items 21–22)
-- =============================================================================
-- UPDATE / DELETE blocked by the trigger in 0002_aux.sql for every role
-- including service_role. RLS here is redundant defense for non-service.
-- INSERT runs in the reward-credit path under service_role.

CREATE POLICY wallet_transactions_select_self
  ON public.wallet_transactions
  FOR SELECT
  TO authenticated
  USING (user_id = (select auth.uid()));

COMMENT ON POLICY wallet_transactions_select_self ON public.wallet_transactions IS
  'A user reads only their own ledger entries. PRD §Phase 2 item 21.';

CREATE POLICY wallet_transactions_select_admin
  ON public.wallet_transactions
  FOR SELECT
  TO authenticated
  USING ((select app_user_role()) = 'gabs_admin');

COMMENT ON POLICY wallet_transactions_select_admin ON public.wallet_transactions IS
  'gabs_admin reads every ledger entry. PRD §Phase 2 item 21.';

-- =============================================================================
-- vouchers
-- =============================================================================
-- Issuance is service_role (server-side reward path). Redemption goes
-- through the `redeem_voucher` RPC declared in a later migration — that
-- RPC runs SECURITY DEFINER and is the only client-callable mutation path.

CREATE POLICY vouchers_select_self
  ON public.vouchers
  FOR SELECT
  TO authenticated
  USING (user_id = (select auth.uid()));

COMMENT ON POLICY vouchers_select_self ON public.vouchers IS
  'A user reads only their own vouchers (issued and redeemed alike).';

CREATE POLICY vouchers_select_admin
  ON public.vouchers
  FOR SELECT
  TO authenticated
  USING ((select app_user_role()) = 'gabs_admin');

COMMENT ON POLICY vouchers_select_admin ON public.vouchers IS
  'gabs_admin reads every voucher for fulfillment and fraud-review.';

-- INSERT / UPDATE / DELETE: no policies → denied for client roles.

-- =============================================================================
-- reward_config (PRD §Phase 2 items 23–24)
-- =============================================================================

CREATE POLICY reward_config_select_all
  ON public.reward_config
  FOR SELECT
  TO authenticated
  USING (true);

COMMENT ON POLICY reward_config_select_all ON public.reward_config IS
  'Every authenticated role reads the reward config. PRD §Phase 2 item 23. Mobile and CRM both display point values; the singleton row contains no PII.';

CREATE POLICY reward_config_insert_admin
  ON public.reward_config
  FOR INSERT
  TO authenticated
  WITH CHECK ((select app_user_role()) = 'gabs_admin');

COMMENT ON POLICY reward_config_insert_admin ON public.reward_config IS
  'Only gabs_admin can insert reward config. PRD §Phase 2 item 24. The singleton row is seeded by 0002_aux.sql; the table CHECK (id = 1) blocks subsequent inserts regardless of role.';

CREATE POLICY reward_config_update_admin
  ON public.reward_config
  FOR UPDATE
  TO authenticated
  USING ((select app_user_role()) = 'gabs_admin')
  WITH CHECK ((select app_user_role()) = 'gabs_admin');

COMMENT ON POLICY reward_config_update_admin ON public.reward_config IS
  'Only gabs_admin updates the reward config singleton (point values, voucher cost). PRD §Phase 2 item 24.';

-- =============================================================================
-- Schema-level lockdown — RLS as the only gate on the row axis.
-- =============================================================================
-- 1. Drop schema CREATE on `public` for client roles (USAGE only). This
--    stops a compromised authenticated session from creating tables or
--    objects in the schema.
-- 2. Strip every default Supabase auto-grant on existing tables, sequences,
--    and functions for anon / authenticated. Re-grant SELECT on all tables
--    to authenticated — RLS now decides which rows. Anon ends up with no
--    table privileges anywhere, which matches the spec (no anonymous read
--    paths in GAIA).
-- 3. Service_role keeps full ALL access (it is the write path for every
--    table) and has BYPASSRLS at the role level, which the platform
--    configures outside this migration.
-- 4. ALTER DEFAULT PRIVILEGES locks future tables created by the migration
--    role to the same perimeter, so a forgotten GRANT in a later migration
--    cannot accidentally open a verb.

REVOKE ALL ON SCHEMA public FROM anon, authenticated;
GRANT  USAGE ON SCHEMA public TO anon, authenticated;

REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated;

GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;

GRANT ALL ON ALL TABLES    IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;

-- Re-grant EXECUTE on the JWT helpers (the blanket REVOKE above caught
-- them). Anon does not need EXECUTE — it has no JWT and the helpers would
-- return NULL.
GRANT EXECUTE ON FUNCTION public.app_user_role()            TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.app_user_dealer_id()       TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.app_user_manufacturer_id() TO authenticated, service_role;

-- Default privileges for tables created in `public` by the migration role
-- in the future — match the explicit grants above so a forgotten GRANT in
-- a later migration cannot accidentally open an unintended verb.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL    ON TABLES TO service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT  ALL ON SEQUENCES TO service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon, authenticated;

COMMIT;
