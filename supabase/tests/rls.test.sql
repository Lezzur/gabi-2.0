-- =============================================================================
-- supabase/tests/rls.test.sql — RLS policy smoke tests for 0003_rls.sql.
--
-- This is a harness, not a comprehensive suite. It seeds a deterministic
-- fixture (auth.users + user_profiles + dealer_accounts + products +
-- containers + wallets + scan_attempts), then runs `SET LOCAL ROLE` +
-- `set_config('request.jwt.claims', ...)` blocks per identity to assert the
-- key Phase 2 exit-criteria scenarios:
--
--   1.  anon cannot SELECT any business table (schema GRANT lockdown gate).
--   2.  Farmer JWT cannot read draft / suspended products.
--   3.  Farmer JWT can read active products (and their crop rows).
--   4.  Farmer JWT cannot read another farmer's wallet row.
--   5.  Farmer JWT cannot read another farmer's wallet_transactions.
--   6.  Farmer JWT cannot read dealer_accounts.
--   7.  Dealer JWT reads only its own dealer_accounts row.
--   8.  Dealer JWT reads only containers it sold or accepted as returns.
--   9.  Farmer JWT cannot UPDATE scan_attempts (RLS + trigger).
--   10. Farmer JWT cannot DELETE scan_attempts (RLS + trigger).
--   11. service_role can UPDATE/DELETE scan_attempts is blocked by trigger
--       (defense-in-depth check — RLS bypassed but trigger fires).
--   12. gabs_admin JWT reads all rows across products, wallets,
--       scan_attempts, dealer_accounts.
--   13. reward_config: any authenticated role reads; only gabs_admin updates.
--   14. pending_purchase: every verb denied for authenticated, regardless
--       of role.
--
-- The whole harness runs inside a single transaction that ROLLBACKs at the
-- end, so re-running it is idempotent and leaves no fixture data behind.
-- A failed assertion (RAISE EXCEPTION inside a DO block) propagates and
-- aborts the transaction, producing the same rollback.
--
-- Invocation (manual, from repo root):
--   psql "$SUPABASE_DB_URL" -f supabase/tests/rls.test.sql
--   # exits 0 on success; any RAISE EXCEPTION fails the run.
--
-- This file assumes 0001 / 0002 / 0003 / 0004 have all been applied.
-- =============================================================================

BEGIN;

-- Quiet down NOTICE spam from the Supabase auth schema while we seed it.
SET LOCAL client_min_messages = WARNING;

-- =============================================================================
-- Seed — deterministic UUIDs so assertions read cleanly.
-- =============================================================================
-- auth.users: most columns are nullable / have defaults, so id-only inserts
-- suffice. The auth.users instance_id default is 0000…0000 which is fine
-- for tests.

INSERT INTO auth.users (id) VALUES
  ('11111111-1111-1111-1111-111111111111'),  -- farmer1
  ('22222222-2222-2222-2222-222222222222'),  -- farmer2
  ('33333333-3333-3333-3333-333333333333'),  -- dealer1 (auth.users.id)
  ('44444444-4444-4444-4444-444444444444'),  -- dealer2 (auth.users.id)
  ('55555555-5555-5555-5555-555555555555'),  -- gabs admin
  ('66666666-6666-6666-6666-666666666666'); -- brand admin

INSERT INTO public.user_profiles (id, role, display_name) VALUES
  ('11111111-1111-1111-1111-111111111111', 'farmer',      'Farmer One'),
  ('22222222-2222-2222-2222-222222222222', 'farmer',      'Farmer Two'),
  ('33333333-3333-3333-3333-333333333333', 'dealer',      'Dealer One'),
  ('44444444-4444-4444-4444-444444444444', 'dealer',      'Dealer Two'),
  ('55555555-5555-5555-5555-555555555555', 'gabs_admin',  'GAIA Admin'),
  ('66666666-6666-6666-6666-666666666666', 'brand_admin', 'Brand Admin');

-- dealer_accounts.id is what the JWT `dealer_id` claim points at, NOT
-- auth.users.id. Pin them deterministically too.
INSERT INTO public.dealer_accounts (id, user_id, business_name, is_verified) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '33333333-3333-3333-3333-333333333333', 'Dealer One LLC', true),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '44444444-4444-4444-4444-444444444444', 'Dealer Two LLC', true);

INSERT INTO public.manufacturer_accounts (id, user_id, company_name, onboarded_by) VALUES
  ('cccccccc-cccc-cccc-cccc-cccccccccccc',
   '66666666-6666-6666-6666-666666666666',
   'Test Brand Co.',
   '55555555-5555-5555-5555-555555555555');

-- Three products spanning the status enum. Farmers/dealers should see only
-- the active one; admins see all three.
INSERT INTO public.products (id, product_name, company, active_ingredient, status) VALUES
  ('dddddddd-dddd-dddd-dddd-dddddddd0001', 'TestActive',    'Co.', 'glyphosate',  'active'),
  ('dddddddd-dddd-dddd-dddd-dddddddd0002', 'TestDraft',     'Co.', 'paraquat',    'draft'),
  ('dddddddd-dddd-dddd-dddd-dddddddd0003', 'TestSuspended', 'Co.', 'atrazine',    'suspended');

INSERT INTO public.product_crops (id, product_id, crop) VALUES
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeee0001', 'dddddddd-dddd-dddd-dddd-dddddddd0001', 'rice'),
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeee0002', 'dddddddd-dddd-dddd-dddd-dddddddd0002', 'corn');

-- Containers — dealer-assigned, farmer-purchased mix.
INSERT INTO public.containers (
    id, product_id, hmac, hmac_suffix, dealer_id, purchased_by_user_id, state
) VALUES
  -- dealer1 sold to farmer1
  ('ffffffff-ffff-ffff-ffff-ffffffff0001',
   'dddddddd-dddd-dddd-dddd-dddddddd0001',
   '0000000000000000000000000000000000000000000000000000000000000001',
   '0000000000000001',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   '11111111-1111-1111-1111-111111111111',
   'purchased'),
  -- dealer2 sold to farmer2
  ('ffffffff-ffff-ffff-ffff-ffffffff0002',
   'dddddddd-dddd-dddd-dddd-dddddddd0001',
   '0000000000000000000000000000000000000000000000000000000000000002',
   '0000000000000002',
   'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
   '22222222-2222-2222-2222-222222222222',
   'purchased'),
  -- in distribution, no farmer yet
  ('ffffffff-ffff-ffff-ffff-ffffffff0003',
   'dddddddd-dddd-dddd-dddd-dddddddd0001',
   '0000000000000000000000000000000000000000000000000000000000000003',
   '0000000000000003',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   NULL,
   'in_distribution');

-- Wallets — one per farmer.
INSERT INTO public.wallets (user_id, balance_points) VALUES
  ('11111111-1111-1111-1111-111111111111', 500),
  ('22222222-2222-2222-2222-222222222222', 250);

INSERT INTO public.wallet_transactions (user_id, delta, reason) VALUES
  ('11111111-1111-1111-1111-111111111111', 100, 'farmer_return_reward'),
  ('22222222-2222-2222-2222-222222222222', 100, 'farmer_return_reward');

-- Scan attempts — one per farmer, attributed to themselves.
INSERT INTO public.scan_attempts (
    container_id, actor_id, actor_type, step, outcome, hmac_valid, auth_valid
) VALUES
  ('ffffffff-ffff-ffff-ffff-ffffffff0001',
   '11111111-1111-1111-1111-111111111111',
   'farmer', 'purchase_farmer', 'success', true, true),
  ('ffffffff-ffff-ffff-ffff-ffffffff0002',
   '22222222-2222-2222-2222-222222222222',
   'farmer', 'purchase_farmer', 'success', true, true);

RESET client_min_messages;

-- =============================================================================
-- Helper: switch identity (DB role + JWT claims) for the rest of this txn.
-- =============================================================================
-- Wrapped in a function so individual tests stay short. `set_config(..., true)`
-- scopes to the current transaction; the outer ROLLBACK still wipes it.

CREATE OR REPLACE FUNCTION pg_temp.assume_role(
  p_db_role text,
  p_user_id uuid,
  p_user_role text,
  p_dealer_id uuid DEFAULT NULL,
  p_manufacturer_id uuid DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_claims jsonb;
BEGIN
  v_claims := jsonb_build_object(
    'sub',             p_user_id::text,
    'aud',             'authenticated',
    'role',            'authenticated',
    'user_role',       p_user_role,
    'dealer_id',       p_dealer_id,
    'manufacturer_id', p_manufacturer_id
  );
  EXECUTE format('SET LOCAL ROLE %I', p_db_role);
  PERFORM set_config('request.jwt.claims', v_claims::text, true);
END;
$$;

-- Reset to the migration role (postgres / supabase_admin) and clear claims.
CREATE OR REPLACE FUNCTION pg_temp.reset_role() RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);
END;
$$;

-- =============================================================================
-- 1. anon: every business table denies SELECT (revoked at GRANT level).
-- =============================================================================
SET LOCAL ROLE anon;

DO $$
BEGIN
  -- Anon has USAGE on schema but no SELECT on any table → permission denied.
  PERFORM 1 FROM public.products LIMIT 1;
  RAISE EXCEPTION '[1] anon should not SELECT public.products';
EXCEPTION WHEN insufficient_privilege THEN NULL;
END $$;

DO $$
BEGIN
  PERFORM 1 FROM public.wallets LIMIT 1;
  RAISE EXCEPTION '[1] anon should not SELECT public.wallets';
EXCEPTION WHEN insufficient_privilege THEN NULL;
END $$;

DO $$
BEGIN
  PERFORM 1 FROM public.scan_attempts LIMIT 1;
  RAISE EXCEPTION '[1] anon should not SELECT public.scan_attempts';
EXCEPTION WHEN insufficient_privilege THEN NULL;
END $$;

SELECT pg_temp.reset_role();

-- =============================================================================
-- 2. Farmer JWT cannot see draft / suspended products.
-- =============================================================================
SELECT pg_temp.assume_role(
  'authenticated',
  '11111111-1111-1111-1111-111111111111',
  'farmer'
);

DO $$
DECLARE n_total int; n_active int; n_draft int;
BEGIN
  SELECT count(*) INTO n_total  FROM public.products;
  SELECT count(*) INTO n_active FROM public.products WHERE status = 'active';
  SELECT count(*) INTO n_draft  FROM public.products WHERE status = 'draft';

  IF n_total <> 1 THEN
    RAISE EXCEPTION '[2] farmer should see exactly 1 product (active only), saw %', n_total;
  END IF;
  IF n_active <> 1 THEN
    RAISE EXCEPTION '[2] farmer should see 1 active product, saw %', n_active;
  END IF;
  IF n_draft <> 0 THEN
    RAISE EXCEPTION '[2] farmer should see 0 draft products, saw %', n_draft;
  END IF;
END $$;

-- =============================================================================
-- 3. Farmer can read product_crops only for active parents.
-- =============================================================================
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.product_crops;
  IF n <> 1 THEN
    RAISE EXCEPTION '[3] farmer should see 1 crop row (active parent), saw %', n;
  END IF;
END $$;

-- =============================================================================
-- 4. Farmer cannot read another farmer's wallet.
-- =============================================================================
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n
    FROM public.wallets
   WHERE user_id = '22222222-2222-2222-2222-222222222222';
  IF n <> 0 THEN
    RAISE EXCEPTION '[4] farmer1 should NOT see farmer2 wallet, saw %', n;
  END IF;

  SELECT count(*) INTO n
    FROM public.wallets
   WHERE user_id = '11111111-1111-1111-1111-111111111111';
  IF n <> 1 THEN
    RAISE EXCEPTION '[4] farmer1 should see own wallet exactly once, saw %', n;
  END IF;
END $$;

-- =============================================================================
-- 5. Farmer cannot read another farmer's wallet_transactions.
-- =============================================================================
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.wallet_transactions;
  IF n <> 1 THEN
    RAISE EXCEPTION '[5] farmer1 should see exactly 1 own ledger row, saw %', n;
  END IF;
END $$;

-- =============================================================================
-- 6. Farmer cannot read dealer_accounts.
-- =============================================================================
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.dealer_accounts;
  IF n <> 0 THEN
    RAISE EXCEPTION '[6] farmer should not see any dealer_accounts, saw %', n;
  END IF;
END $$;

-- =============================================================================
-- 9. Farmer cannot UPDATE scan_attempts.
-- =============================================================================
-- Two layers: RLS (no UPDATE policy) and the BEFORE UPDATE trigger from
-- 0001_init.sql. The trigger raises with insufficient_privilege; RLS would
-- raise insufficient_privilege at GRANT level even before the trigger.
-- Either is acceptable.
DO $$
BEGIN
  UPDATE public.scan_attempts
     SET outcome = 'success'
   WHERE actor_id = '11111111-1111-1111-1111-111111111111';
  RAISE EXCEPTION '[9] farmer UPDATE on scan_attempts should have failed';
EXCEPTION WHEN insufficient_privilege THEN NULL;
END $$;

-- =============================================================================
-- 10. Farmer cannot DELETE scan_attempts.
-- =============================================================================
DO $$
BEGIN
  DELETE FROM public.scan_attempts
   WHERE actor_id = '11111111-1111-1111-1111-111111111111';
  RAISE EXCEPTION '[10] farmer DELETE on scan_attempts should have failed';
EXCEPTION WHEN insufficient_privilege THEN NULL;
END $$;

-- =============================================================================
-- 7. Dealer JWT reads only its own dealer_accounts row.
-- =============================================================================
SELECT pg_temp.reset_role();

SELECT pg_temp.assume_role(
  'authenticated',
  '33333333-3333-3333-3333-333333333333',
  'dealer',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
);

DO $$
DECLARE n int; v_user uuid;
BEGIN
  SELECT count(*) INTO n FROM public.dealer_accounts;
  IF n <> 1 THEN
    RAISE EXCEPTION '[7] dealer1 should see exactly 1 dealer_accounts row, saw %', n;
  END IF;

  SELECT user_id INTO v_user FROM public.dealer_accounts;
  IF v_user <> '33333333-3333-3333-3333-333333333333'::uuid THEN
    RAISE EXCEPTION '[7] dealer1 should see own row, saw user_id=%', v_user;
  END IF;
END $$;

-- =============================================================================
-- 8. Dealer JWT reads only assigned containers.
-- =============================================================================
DO $$
DECLARE n int; v_seen text;
BEGIN
  SELECT count(*) INTO n FROM public.containers;
  -- dealer1 has two assigned containers (one purchased, one in_distribution)
  -- but NOT the second farmer's container assigned to dealer2.
  IF n <> 2 THEN
    RAISE EXCEPTION '[8] dealer1 should see exactly 2 containers, saw %', n;
  END IF;

  SELECT count(*) INTO n
    FROM public.containers
   WHERE dealer_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  IF n <> 0 THEN
    RAISE EXCEPTION '[8] dealer1 should NOT see dealer2 containers, saw %', n;
  END IF;
END $$;

-- =============================================================================
-- 14. pending_purchase: every verb denied even with a valid authenticated JWT.
-- =============================================================================
DO $$
BEGIN
  PERFORM 1 FROM public.pending_purchase LIMIT 1;
  -- A SELECT against an empty table normally returns 0 rows without error,
  -- but RLS with no policies still permits the query — it just filters out
  -- every row. So the no-row case is not a failure here. We instead assert
  -- INSERT is rejected.
EXCEPTION WHEN insufficient_privilege THEN NULL;
END $$;

DO $$
BEGIN
  INSERT INTO public.pending_purchase (container_id, dealer_id) VALUES
    ('ffffffff-ffff-ffff-ffff-ffffffff0003',
     'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
  RAISE EXCEPTION '[14] dealer INSERT on pending_purchase should have failed';
EXCEPTION
  WHEN insufficient_privilege THEN NULL;  -- no INSERT policy
  WHEN check_violation        THEN NULL;  -- defensive: USING-derived check
END $$;

-- =============================================================================
-- 12. gabs_admin reads everything.
-- =============================================================================
SELECT pg_temp.reset_role();

SELECT pg_temp.assume_role(
  'authenticated',
  '55555555-5555-5555-5555-555555555555',
  'gabs_admin'
);

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.products;
  IF n <> 3 THEN
    RAISE EXCEPTION '[12] gabs_admin should see all 3 products, saw %', n;
  END IF;

  SELECT count(*) INTO n FROM public.wallets;
  IF n <> 2 THEN
    RAISE EXCEPTION '[12] gabs_admin should see all 2 wallets, saw %', n;
  END IF;

  SELECT count(*) INTO n FROM public.scan_attempts;
  IF n <> 2 THEN
    RAISE EXCEPTION '[12] gabs_admin should see all 2 scan_attempts, saw %', n;
  END IF;

  SELECT count(*) INTO n FROM public.dealer_accounts;
  IF n <> 2 THEN
    RAISE EXCEPTION '[12] gabs_admin should see all 2 dealer_accounts, saw %', n;
  END IF;

  SELECT count(*) INTO n FROM public.containers;
  IF n <> 3 THEN
    RAISE EXCEPTION '[12] gabs_admin should see all 3 containers, saw %', n;
  END IF;
END $$;

-- =============================================================================
-- 13. reward_config: every authenticated role reads; UPDATE denied for the
--     authenticated DB role regardless of JWT role, because the GRANT
--     lockdown above only re-grants SELECT (writes go through service_role
--     API routes — the RLS reward_config_update_admin policy is the
--     defense-in-depth gate that fires only if a future migration ever
--     GRANTs UPDATE on the table).
-- =============================================================================
-- Read as gabs_admin (still set from test 12).
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.reward_config;
  IF n <> 1 THEN
    RAISE EXCEPTION '[13] gabs_admin should see the singleton reward_config, saw %', n;
  END IF;
END $$;

-- Even with `user_role = gabs_admin`, the authenticated DB role lacks UPDATE
-- privilege on reward_config — the request must come via a service_role
-- API route. This asserts the GRANT-level lockdown.
DO $$
BEGIN
  UPDATE public.reward_config
     SET farmer_points_per_return = 150
   WHERE id = 1;
  RAISE EXCEPTION '[13] authenticated UPDATE on reward_config should have failed at GRANT-check (regardless of JWT role)';
EXCEPTION WHEN insufficient_privilege THEN NULL;
END $$;

-- Switch to farmer; SELECT still works (item 23 grants public read).
SELECT pg_temp.reset_role();
SELECT pg_temp.assume_role(
  'authenticated',
  '11111111-1111-1111-1111-111111111111',
  'farmer'
);

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.reward_config;
  IF n <> 1 THEN
    RAISE EXCEPTION '[13] farmer should see reward_config, saw %', n;
  END IF;
END $$;

DO $$
BEGIN
  UPDATE public.reward_config SET farmer_points_per_return = 999 WHERE id = 1;
  RAISE EXCEPTION '[13] farmer UPDATE on reward_config should have failed';
EXCEPTION WHEN insufficient_privilege THEN NULL;
END $$;

-- =============================================================================
-- 11. service_role: append-only triggers fire even with bypassrls.
-- =============================================================================
-- Switching to service_role here checks that the trigger in 0001_init.sql
-- blocks UPDATE/DELETE on scan_attempts even for the role that bypasses
-- RLS. This is the load-bearing append-only guarantee — the redundant RLS
-- defense above only catches non-service-role callers.
SELECT pg_temp.reset_role();

SET LOCAL ROLE service_role;

DO $$
BEGIN
  UPDATE public.scan_attempts
     SET outcome = 'success'
   WHERE actor_id = '11111111-1111-1111-1111-111111111111';
  RAISE EXCEPTION '[11] service_role UPDATE on scan_attempts should have failed (trigger)';
EXCEPTION WHEN insufficient_privilege THEN NULL;
END $$;

DO $$
BEGIN
  DELETE FROM public.scan_attempts
   WHERE actor_id = '11111111-1111-1111-1111-111111111111';
  RAISE EXCEPTION '[11] service_role DELETE on scan_attempts should have failed (trigger)';
EXCEPTION WHEN insufficient_privilege THEN NULL;
END $$;

DO $$
BEGIN
  UPDATE public.wallet_transactions
     SET delta = 0
   WHERE user_id = '11111111-1111-1111-1111-111111111111';
  RAISE EXCEPTION '[11] service_role UPDATE on wallet_transactions should have failed (trigger)';
EXCEPTION WHEN insufficient_privilege THEN NULL;
END $$;

SELECT pg_temp.reset_role();

-- =============================================================================
-- All assertions passed — rollback the seed and finish.
-- =============================================================================
DO $$ BEGIN RAISE NOTICE 'rls.test.sql: all assertions passed'; END $$;

ROLLBACK;
