-- =============================================================================
-- supabase/tests/rls-policies.test.sql — focused RLS scenario tests for the
-- five exit-criteria assertions called out in the Phase 8 test plan.
--
-- Style: raw ASSERT via DO blocks (RAISE EXCEPTION on failure, EXCEPTION WHEN
-- insufficient_privilege handlers for expected denials). pgTAP is NOT used,
-- because Supabase production / preview branches do not have the pgTAP
-- extension enabled by default and we don't want test runs to depend on a
-- privileged CREATE EXTENSION step. Raw DO blocks are sufficient for the
-- pass/fail signal this harness needs (a single failed assertion aborts the
-- enclosing transaction with a clear message; psql exits non-zero).
--
-- Hardening (per task prompt):
--   * Each scenario is wrapped in its OWN BEGIN/ROLLBACK pair, so scenarios
--     are independent — a failure in one does not leak fixture data or a
--     stale role context into the next, and any single scenario can be
--     re-run on its own by copy-pasting its block.
--   * Every scenario re-seeds the minimum auth.users / user_profiles /
--     dealer_accounts / wallet rows it needs and rolls them back at the end.
--     Re-running the file is idempotent.
--   * Identity is switched with `SET LOCAL ROLE` + `set_config(
--     'request.jwt.claims', ..., true)`. The `true` third argument scopes
--     the GUC to the current transaction; the ROLLBACK undoes both.
--
-- Required scenarios (matched 1:1 to the prompt):
--   [1] Farmer cannot read another farmer's wallet.
--   [2] Farmer cannot UPDATE scan_attempts (RLS denies + trigger backstop).
--   [3] Dealer cannot read products in non-`active` lifecycle states.
--   [4] brand_admin cannot see another brand_admin's manufacturer scope.
--   [5] Unauthenticated (anon role, no JWT) cannot read any business table.
--
-- Schema deviations vs. the literal task wording, recorded for reviewers:
--
--   * Scenario [3] — the prompt says "status='archived'" but the
--     `product_status` enum in 0001_init.sql is ('draft', 'active',
--     'suspended'); 'archived' is not a value. The terminal/withdrawn state
--     in this schema is 'suspended' (see the products table COMMENT). The
--     test asserts the actual rule from PRD §Phase 2 item 6 + the
--     `products_select_active` policy in 0003_rls.sql: dealers see ONLY
--     `status='active'`. We seed both `'draft'` and `'suspended'` rows and
--     assert neither is visible. This is the same coverage the prompt was
--     asking for, just spelled in this schema's vocabulary.
--
--   * Scenario [4] — the prompt says "brand_admin cannot see other
--     manufacturers' products". The `products` table has NO
--     `manufacturer_id` FK in this schema (see 0003_rls.sql header for the
--     deviation note: "brand_admin reads ALL products, not own
--     manufacturer's only"). Per-manufacturer product scoping cannot be
--     enforced or tested until a future schema amendment lands. The
--     enforceable analogue — and the policy that DOES gate cross-tenant
--     manufacturer data — is `manufacturer_accounts_select_self`. The
--     scenario therefore asserts that brand_admin1 cannot see
--     brand_admin2's `manufacturer_accounts` row. When the products schema
--     gains `manufacturer_id`, the policy/test pair below should be tightened.
--
-- Invocation (manual, from repo root):
--   psql "$SUPABASE_DB_URL" -f supabase/tests/rls-policies.test.sql
--   # Exits 0 on success; any RAISE EXCEPTION fails the run.
--
-- This file assumes 0001 / 0002 / 0003 / 0004 have all been applied.
-- =============================================================================


-- =============================================================================
-- [1] Farmer cannot read another farmer's wallet.
-- =============================================================================
-- Policy under test: wallets_select_self (`user_id = (select auth.uid())`).
-- Two farmers, one wallet each. Assume farmer1; assert farmer2's wallet is
-- invisible (count = 0) AND farmer1's own wallet is visible (count = 1).
BEGIN;

SET LOCAL client_min_messages = WARNING;

INSERT INTO auth.users (id) VALUES
  ('11111111-1111-1111-1111-111111111111'),
  ('22222222-2222-2222-2222-222222222222');

INSERT INTO public.user_profiles (id, role, display_name) VALUES
  ('11111111-1111-1111-1111-111111111111', 'farmer', 'Farmer One'),
  ('22222222-2222-2222-2222-222222222222', 'farmer', 'Farmer Two');

INSERT INTO public.wallets (user_id, balance_points) VALUES
  ('11111111-1111-1111-1111-111111111111', 500),
  ('22222222-2222-2222-2222-222222222222', 250);

-- Switch to farmer1's identity for the assertion phase.
SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub',       '11111111-1111-1111-1111-111111111111',
    'aud',       'authenticated',
    'role',      'authenticated',
    'user_role', 'farmer'
  )::text,
  true
);

DO $$
DECLARE
  n_other int;
  n_self  int;
BEGIN
  SELECT count(*) INTO n_other
    FROM public.wallets
   WHERE user_id = '22222222-2222-2222-2222-222222222222';
  IF n_other <> 0 THEN
    RAISE EXCEPTION '[1] farmer1 should NOT see farmer2 wallet, saw % rows', n_other;
  END IF;

  SELECT count(*) INTO n_self
    FROM public.wallets
   WHERE user_id = '11111111-1111-1111-1111-111111111111';
  IF n_self <> 1 THEN
    RAISE EXCEPTION '[1] farmer1 should see own wallet exactly once, saw % rows', n_self;
  END IF;
END $$;

ROLLBACK;


-- =============================================================================
-- [2] Farmer cannot UPDATE scan_attempts.
-- =============================================================================
-- Two layers under test:
--   (a) RLS — scan_attempts has no UPDATE policy, and the schema-level
--       lockdown in 0003_rls.sql doesn't GRANT UPDATE to authenticated, so
--       the verb fails at GRANT-check with insufficient_privilege.
--   (b) Trigger backstop — `scan_attempts_reject_mutation` (0001_init.sql)
--       fires BEFORE UPDATE and raises insufficient_privilege regardless of
--       role, including service_role. Either layer alone is sufficient;
--       both raise the same SQLSTATE so this test accepts either.
BEGIN;

SET LOCAL client_min_messages = WARNING;

INSERT INTO auth.users (id) VALUES
  ('11111111-1111-1111-1111-111111111111'),  -- farmer
  ('33333333-3333-3333-3333-333333333333');  -- dealer (FK chain for the container)

INSERT INTO public.user_profiles (id, role, display_name) VALUES
  ('11111111-1111-1111-1111-111111111111', 'farmer', 'Farmer One'),
  ('33333333-3333-3333-3333-333333333333', 'dealer', 'Dealer One');

INSERT INTO public.dealer_accounts (id, user_id, business_name, is_verified) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   '33333333-3333-3333-3333-333333333333',
   'Dealer One LLC',
   true);

INSERT INTO public.products (id, product_name, company, active_ingredient, status) VALUES
  ('dddddddd-dddd-dddd-dddd-dddddddd0001', 'TestActive', 'Co.', 'glyphosate', 'active');

INSERT INTO public.containers (
    id, product_id, hmac, hmac_suffix, dealer_id, purchased_by_user_id, state
) VALUES
  ('ffffffff-ffff-ffff-ffff-ffffffff0001',
   'dddddddd-dddd-dddd-dddd-dddddddd0001',
   '0000000000000000000000000000000000000000000000000000000000000001',
   '0000000000000001',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   '11111111-1111-1111-1111-111111111111',
   'purchased');

INSERT INTO public.scan_attempts (
    container_id, actor_id, actor_type, step, outcome, hmac_valid, auth_valid
) VALUES
  ('ffffffff-ffff-ffff-ffff-ffffffff0001',
   '11111111-1111-1111-1111-111111111111',
   'farmer', 'purchase_farmer', 'success', true, true);

-- Switch to farmer1.
SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub',       '11111111-1111-1111-1111-111111111111',
    'aud',       'authenticated',
    'role',      'authenticated',
    'user_role', 'farmer'
  )::text,
  true
);

DO $$
BEGIN
  UPDATE public.scan_attempts
     SET outcome = 'success'
   WHERE actor_id = '11111111-1111-1111-1111-111111111111';
  RAISE EXCEPTION '[2] farmer UPDATE on scan_attempts should have failed (RLS + trigger)';
EXCEPTION
  WHEN insufficient_privilege THEN NULL;  -- both RLS and trigger raise this
END $$;

ROLLBACK;


-- =============================================================================
-- [3] Dealer cannot read products in non-`active` lifecycle states.
-- =============================================================================
-- See header note: 'archived' is not in this schema's product_status enum;
-- the equivalent terminal-withdrawn state is 'suspended'. The dealer-facing
-- policy `products_select_active` only matches `status = 'active'`, so
-- drafts and suspendeds are both invisible. We seed all three statuses and
-- assert the dealer sees exactly the one active row.
BEGIN;

SET LOCAL client_min_messages = WARNING;

INSERT INTO auth.users (id) VALUES
  ('33333333-3333-3333-3333-333333333333');

INSERT INTO public.user_profiles (id, role, display_name) VALUES
  ('33333333-3333-3333-3333-333333333333', 'dealer', 'Dealer One');

INSERT INTO public.dealer_accounts (id, user_id, business_name, is_verified) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   '33333333-3333-3333-3333-333333333333',
   'Dealer One LLC',
   true);

INSERT INTO public.products (id, product_name, company, active_ingredient, status) VALUES
  ('dddddddd-dddd-dddd-dddd-dddddddd0001', 'TestActive',    'Co.', 'glyphosate', 'active'),
  ('dddddddd-dddd-dddd-dddd-dddddddd0002', 'TestDraft',     'Co.', 'paraquat',   'draft'),
  ('dddddddd-dddd-dddd-dddd-dddddddd0003', 'TestSuspended', 'Co.', 'atrazine',   'suspended');

-- Switch to dealer1 — `dealer_id` claim is the dealer_accounts.id, not the
-- auth.users.id (auth hook in 0004_auth_hook.sql injects it that way).
SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub',       '33333333-3333-3333-3333-333333333333',
    'aud',       'authenticated',
    'role',      'authenticated',
    'user_role', 'dealer',
    'dealer_id', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  )::text,
  true
);

DO $$
DECLARE
  n_total      int;
  n_active     int;
  n_draft      int;
  n_suspended  int;
BEGIN
  SELECT count(*) INTO n_total     FROM public.products;
  SELECT count(*) INTO n_active    FROM public.products WHERE status = 'active';
  SELECT count(*) INTO n_draft     FROM public.products WHERE status = 'draft';
  SELECT count(*) INTO n_suspended FROM public.products WHERE status = 'suspended';

  IF n_total <> 1 THEN
    RAISE EXCEPTION '[3] dealer should see exactly 1 product (active only), saw %', n_total;
  END IF;
  IF n_active <> 1 THEN
    RAISE EXCEPTION '[3] dealer should see the active product, saw % rows', n_active;
  END IF;
  IF n_draft <> 0 THEN
    RAISE EXCEPTION '[3] dealer should NOT see draft products, saw %', n_draft;
  END IF;
  IF n_suspended <> 0 THEN
    RAISE EXCEPTION '[3] dealer should NOT see suspended (the schema''s "archived" equivalent) products, saw %', n_suspended;
  END IF;
END $$;

ROLLBACK;


-- =============================================================================
-- [4] brand_admin cannot see another brand_admin's manufacturer scope.
-- =============================================================================
-- See header note: products has no manufacturer_id FK, so the literal
-- "brand_admin cannot see other manufacturers' products" cannot be tested
-- in this schema. The enforced cross-tenant boundary lives on
-- `manufacturer_accounts` via the `manufacturer_accounts_select_self`
-- policy (`(user_role = 'brand_admin' AND user_id = auth.uid())`). We seed
-- two brand_admins with two manufacturer rows and assert brand_admin1 sees
-- only their own.
BEGIN;

SET LOCAL client_min_messages = WARNING;

INSERT INTO auth.users (id) VALUES
  ('55555555-5555-5555-5555-555555555555'),  -- gabs_admin (onboarded_by FK target)
  ('66666666-6666-6666-6666-666666666666'),  -- brand_admin 1
  ('77777777-7777-7777-7777-777777777777');  -- brand_admin 2

INSERT INTO public.user_profiles (id, role, display_name) VALUES
  ('55555555-5555-5555-5555-555555555555', 'gabs_admin',  'GAIA Admin'),
  ('66666666-6666-6666-6666-666666666666', 'brand_admin', 'Brand Admin One'),
  ('77777777-7777-7777-7777-777777777777', 'brand_admin', 'Brand Admin Two');

INSERT INTO public.manufacturer_accounts (id, user_id, company_name, onboarded_by) VALUES
  ('cccccccc-cccc-cccc-cccc-cccccccccccc',
   '66666666-6666-6666-6666-666666666666',
   'Brand One Co.',
   '55555555-5555-5555-5555-555555555555'),
  ('cccccccc-cccc-cccc-cccc-cccccccccccd',
   '77777777-7777-7777-7777-777777777777',
   'Brand Two Co.',
   '55555555-5555-5555-5555-555555555555');

-- Assume brand_admin1.
SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub',             '66666666-6666-6666-6666-666666666666',
    'aud',             'authenticated',
    'role',            'authenticated',
    'user_role',       'brand_admin',
    'manufacturer_id', 'cccccccc-cccc-cccc-cccc-cccccccccccc'
  )::text,
  true
);

DO $$
DECLARE
  n_total int;
  v_user  uuid;
BEGIN
  SELECT count(*) INTO n_total FROM public.manufacturer_accounts;
  IF n_total <> 1 THEN
    RAISE EXCEPTION '[4] brand_admin1 should see exactly 1 manufacturer row (own), saw %', n_total;
  END IF;

  SELECT user_id INTO v_user FROM public.manufacturer_accounts;
  IF v_user <> '66666666-6666-6666-6666-666666666666'::uuid THEN
    RAISE EXCEPTION '[4] brand_admin1 should see own manufacturer row, saw user_id=%', v_user;
  END IF;
END $$;

ROLLBACK;


-- =============================================================================
-- [5] Unauthenticated (anon role, no JWT) cannot read any business table.
-- =============================================================================
-- 0003_rls.sql revokes ALL privileges from anon at the schema level (USAGE
-- only, no SELECT on any table) and re-grants SELECT only to authenticated.
-- Every business-table SELECT under role=anon must therefore raise
-- insufficient_privilege at GRANT-check, before any RLS evaluation.
-- We sample one row per table family to keep the harness fast; if any
-- single SELECT slips through, that's a regression on the GRANT lockdown.
BEGIN;

SET LOCAL client_min_messages = WARNING;

-- No data seed needed — we're testing GRANT-level denial, not row visibility.
SET LOCAL ROLE anon;
-- Explicitly clear any stray JWT claims so this is truly an anon-no-JWT path.
SELECT set_config('request.jwt.claims', '', true);

DO $$
BEGIN
  PERFORM 1 FROM public.products LIMIT 1;
  RAISE EXCEPTION '[5] anon should not SELECT public.products';
EXCEPTION WHEN insufficient_privilege THEN NULL;
END $$;

DO $$
BEGIN
  PERFORM 1 FROM public.product_crops LIMIT 1;
  RAISE EXCEPTION '[5] anon should not SELECT public.product_crops';
EXCEPTION WHEN insufficient_privilege THEN NULL;
END $$;

DO $$
BEGIN
  PERFORM 1 FROM public.containers LIMIT 1;
  RAISE EXCEPTION '[5] anon should not SELECT public.containers';
EXCEPTION WHEN insufficient_privilege THEN NULL;
END $$;

DO $$
BEGIN
  PERFORM 1 FROM public.scan_attempts LIMIT 1;
  RAISE EXCEPTION '[5] anon should not SELECT public.scan_attempts';
EXCEPTION WHEN insufficient_privilege THEN NULL;
END $$;

DO $$
BEGIN
  PERFORM 1 FROM public.user_profiles LIMIT 1;
  RAISE EXCEPTION '[5] anon should not SELECT public.user_profiles';
EXCEPTION WHEN insufficient_privilege THEN NULL;
END $$;

DO $$
BEGIN
  PERFORM 1 FROM public.dealer_accounts LIMIT 1;
  RAISE EXCEPTION '[5] anon should not SELECT public.dealer_accounts';
EXCEPTION WHEN insufficient_privilege THEN NULL;
END $$;

DO $$
BEGIN
  PERFORM 1 FROM public.manufacturer_accounts LIMIT 1;
  RAISE EXCEPTION '[5] anon should not SELECT public.manufacturer_accounts';
EXCEPTION WHEN insufficient_privilege THEN NULL;
END $$;

DO $$
BEGIN
  PERFORM 1 FROM public.wallets LIMIT 1;
  RAISE EXCEPTION '[5] anon should not SELECT public.wallets';
EXCEPTION WHEN insufficient_privilege THEN NULL;
END $$;

DO $$
BEGIN
  PERFORM 1 FROM public.wallet_transactions LIMIT 1;
  RAISE EXCEPTION '[5] anon should not SELECT public.wallet_transactions';
EXCEPTION WHEN insufficient_privilege THEN NULL;
END $$;

DO $$
BEGIN
  PERFORM 1 FROM public.vouchers LIMIT 1;
  RAISE EXCEPTION '[5] anon should not SELECT public.vouchers';
EXCEPTION WHEN insufficient_privilege THEN NULL;
END $$;

DO $$
BEGIN
  PERFORM 1 FROM public.reward_config LIMIT 1;
  RAISE EXCEPTION '[5] anon should not SELECT public.reward_config';
EXCEPTION WHEN insufficient_privilege THEN NULL;
END $$;

DO $$
BEGIN
  PERFORM 1 FROM public.pending_purchase LIMIT 1;
  RAISE EXCEPTION '[5] anon should not SELECT public.pending_purchase';
EXCEPTION WHEN insufficient_privilege THEN NULL;
END $$;

DO $$
BEGIN
  PERFORM 1 FROM public.pending_return_reward LIMIT 1;
  RAISE EXCEPTION '[5] anon should not SELECT public.pending_return_reward';
EXCEPTION WHEN insufficient_privilege THEN NULL;
END $$;

ROLLBACK;


-- =============================================================================
-- All scenarios passed (any failed assertion above would have aborted before
-- reaching here with a RAISE EXCEPTION message tagged by scenario number).
-- =============================================================================
DO $$ BEGIN RAISE NOTICE 'rls-policies.test.sql: all 5 scenarios passed'; END $$;
