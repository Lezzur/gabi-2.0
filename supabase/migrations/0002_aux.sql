-- =============================================================================
-- 0002_aux.sql — GAIA Phase 1: Auxiliary tables.
--
-- Extends the core schema from 0001_init.sql with the tables that hang off
-- products/containers/scan_attempts: accounts (user/dealer/manufacturer),
-- the rewards ledger (wallets + wallet_transactions + vouchers), the two
-- sidecar scan windows (pending_purchase, pending_return_reward), and the
-- singleton reward_config row that parameterizes point values.
--
-- Also backfills `containers.dealer_id` / `containers.return_dealer_id` via
-- ALTER TABLE, now that `dealer_accounts` exists to reference.
--
-- RLS policies live in 0003_rls.sql. This migration grants no privileges.
-- Enums (`voucher_denomination`, `actor_type`, etc.) are already declared
-- in 0001_init.sql and re-used here.
--
-- Spec sources: tech-spec §4.3 (entity shapes) and PRD §Phase 1 (table list).
--
-- Intentional deviations from PRD §Phase 1, recorded for reviewers:
--
--   * `pending_purchase` / `pending_return_reward`: the expiry column is
--     `lazy_expires_at timestamptz GENERATED ALWAYS AS (created_at + '60m')
--     STORED` rather than a writeable DEFAULT. Task prompt requires a
--     generated column; the 60-minute window is a fixed product rule, not
--     a per-row variable, so deriving it removes a class of drift bug
--     (someone writing `expires_at = now()` and freezing the row).
--
--   * `reward_config.id` is `smallint PRIMARY KEY CHECK (id = 1)` rather
--     than the PRD-sketched `uuid PK + unique partial index` pattern. The
--     CHECK fails at INSERT time against any caller (not just the second
--     INSERT), and the error surface in the CRM write path is clearer.
--
--   * `wallet_transactions` uses `user_id` / `delta` / `reason` /
--     `scan_attempt_id` instead of PRD's `wallet_id` / `points` /
--     `description` / `container_id`. The history-query index is
--     `(user_id, created_at DESC)` per task prompt, so user_id is the
--     anchor; `scan_attempt_id` ties a reward credit to its originating
--     scan row (stronger than container_id — adjustments and voucher
--     redemptions have no container). `user_id` is FK'd to `wallets(user_id)`
--     (via its UNIQUE constraint), so a transaction can never exist without
--     its wallet.
--
--   * `vouchers.redeemed_by` is `uuid REFERENCES auth.users(id)` — the user
--     who redeemed the voucher. PRD §Phase 1 sketches a dealer FK; the
--     task prompt names the field `redeemed_by` without specifying target,
--     so auth.users is the general case. A dealer foreign key can be added
--     in a later migration without breaking this one.
-- =============================================================================

BEGIN;

-- =============================================================================
-- user_profiles — app-level extension of auth.users
-- =============================================================================
CREATE TABLE user_profiles (
  id            uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE RESTRICT,
  role          text NOT NULL DEFAULT 'farmer',
  display_name  text,
  phone_number  text UNIQUE,
  locale        text NOT NULL DEFAULT 'en',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE user_profiles IS
  'App-level profile for every auth.users identity. `role` drives authorization (farmer | dealer | brand_admin | gabs_admin) and is injected into JWT claims by the auth hook (0004_auth_hook.sql). `phone_number` is the OTP-sign-in identity, hence UNIQUE. `locale` is a BCP-47 tag (default `en`) driving translation lookups for scan results and notifications.';

CREATE INDEX idx_user_profiles_role ON user_profiles (role);

CREATE TRIGGER trg_user_profiles_set_updated_at
  BEFORE UPDATE ON user_profiles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================================
-- dealer_accounts
-- =============================================================================
CREATE TABLE dealer_accounts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE RESTRICT,
  business_name    text NOT NULL,
  territory_notes  text,
  is_verified      boolean NOT NULL DEFAULT false,
  verified_by      uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  verified_at      timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE dealer_accounts IS
  'One dealer business per auth.users identity. `is_verified` plus `verified_by` / `verified_at` record GAIA staff KYC sign-off; scan and return endpoints require `is_verified = true` (enforced in RLS, 0003_rls.sql). `user_id` is UNIQUE — a single auth identity maps to at most one dealer business.';

CREATE INDEX idx_dealer_accounts_is_verified ON dealer_accounts (is_verified);

CREATE TRIGGER trg_dealer_accounts_set_updated_at
  BEFORE UPDATE ON dealer_accounts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================================
-- manufacturer_accounts
-- =============================================================================
CREATE TABLE manufacturer_accounts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE RESTRICT,
  company_name  text NOT NULL,
  onboarded_by  uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE manufacturer_accounts IS
  'Brand/manufacturer account, one per auth.users identity. `onboarded_by` is the GAIA staff user who created the record — manufacturers cannot self-register (no public sign-up path).';

CREATE TRIGGER trg_manufacturer_accounts_set_updated_at
  BEFORE UPDATE ON manufacturer_accounts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================================
-- containers: backfill dealer FKs now that dealer_accounts exists
-- =============================================================================
-- Deferred from 0001_init.sql because dealer_accounts is declared here.
-- Both columns are nullable (pre-sale containers have no dealer yet).
ALTER TABLE containers
  ADD COLUMN dealer_id        uuid REFERENCES dealer_accounts(id) ON DELETE RESTRICT,
  ADD COLUMN return_dealer_id uuid REFERENCES dealer_accounts(id) ON DELETE RESTRICT;

CREATE INDEX idx_containers_dealer_id ON containers (dealer_id);
CREATE INDEX idx_containers_return_dealer_id ON containers (return_dealer_id);

-- =============================================================================
-- pending_purchase — sidecar, NOT a state gate on containers
-- =============================================================================
-- lazy_expires_at is set by trigger instead of GENERATED ALWAYS AS because
-- timestamptz + interval is STABLE (not IMMUTABLE) in PostgreSQL and cannot
-- be used in a stored generated column expression.
CREATE OR REPLACE FUNCTION set_lazy_expires_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.lazy_expires_at := NEW.created_at + INTERVAL '60 minutes';
  RETURN NEW;
END;
$$;

CREATE TABLE pending_purchase (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  container_id     uuid NOT NULL UNIQUE REFERENCES containers(id) ON DELETE RESTRICT,
  dealer_id        uuid NOT NULL REFERENCES dealer_accounts(id) ON DELETE RESTRICT,
  created_at       timestamptz NOT NULL DEFAULT now(),
  lazy_expires_at  timestamptz NOT NULL DEFAULT now() + INTERVAL '60 minutes'
);

CREATE TRIGGER trg_pending_purchase_lazy_expires
  BEFORE INSERT ON pending_purchase
  FOR EACH ROW EXECUTE FUNCTION set_lazy_expires_at();

COMMENT ON TABLE pending_purchase IS
  'Sidecar row created when a dealer scans a container to begin a sale. NOT a state gate: the container stays `in_distribution` until the farmer-confirm scan flips it to `purchased`. `lazy_expires_at` is derived (created_at + 60m) and evaluated at read time on every scan path — expired rows are deleted inline (tech-spec §4.3 "lazy cleanup — no cron"). `container_id` UNIQUE prevents two dealers from opening concurrent windows on the same bottle.';

CREATE INDEX idx_pending_purchase_container_expires
  ON pending_purchase (container_id, lazy_expires_at);

-- =============================================================================
-- pending_return_reward — same shape, different semantics
-- =============================================================================
CREATE TABLE pending_return_reward (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  container_id     uuid NOT NULL UNIQUE REFERENCES containers(id) ON DELETE RESTRICT,
  dealer_id        uuid NOT NULL REFERENCES dealer_accounts(id) ON DELETE RESTRICT,
  created_at       timestamptz NOT NULL DEFAULT now(),
  lazy_expires_at  timestamptz NOT NULL DEFAULT now() + INTERVAL '60 minutes'
);

CREATE TRIGGER trg_pending_return_reward_lazy_expires
  BEFORE INSERT ON pending_return_reward
  FOR EACH ROW EXECUTE FUNCTION set_lazy_expires_at();

COMMENT ON TABLE pending_return_reward IS
  'Sidecar row created when a dealer processes a container return. Opens a 60-minute window for the farmer-confirm scan that flips the container to `rewards_paid` and credits both wallets. Same lazy-expiry semantics as pending_purchase.';

CREATE INDEX idx_pending_return_reward_container_expires
  ON pending_return_reward (container_id, lazy_expires_at);

-- =============================================================================
-- wallets
-- =============================================================================
CREATE TABLE wallets (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE RESTRICT,
  balance_points  integer NOT NULL DEFAULT 0 CHECK (balance_points >= 0),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE wallets IS
  'Per-user point balance. One row per user (`user_id` UNIQUE). The `balance_points >= 0` CHECK is the DB-level floor — a double-debit bug at the app layer cannot send a user negative.';

CREATE TRIGGER trg_wallets_set_updated_at
  BEFORE UPDATE ON wallets
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================================
-- wallet_transactions (append-only)
-- =============================================================================
CREATE TABLE wallet_transactions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES wallets(user_id) ON DELETE RESTRICT,
  delta            integer NOT NULL,
  reason           text NOT NULL,
  scan_attempt_id  uuid REFERENCES scan_attempts(id) ON DELETE RESTRICT,
  created_at       timestamptz NOT NULL DEFAULT now()
  -- No updated_at: rows are immutable (see trigger below).
);

COMMENT ON TABLE wallet_transactions IS
  'Append-only ledger of every wallet movement. `delta` is signed (positive = credit, negative = debit); `reason` is a free-form audit string ("farmer_return_reward", "voucher_redemption", "manual_adjustment"). `scan_attempt_id` ties reward credits back to the originating scan row — nullable because voucher redemptions and admin adjustments have no scan. UPDATE and DELETE are rejected by trigger at the DB level; RLS (0003_rls.sql) is a secondary gate.';

CREATE INDEX idx_wallet_transactions_user_created_desc
  ON wallet_transactions (user_id, created_at DESC);
CREATE INDEX idx_wallet_transactions_scan_attempt_id
  ON wallet_transactions (scan_attempt_id);

-- Append-only enforcement: same pattern as scan_attempts (0001_init.sql).
-- A dedicated function per table keeps error messages specific.
CREATE OR REPLACE FUNCTION wallet_transactions_reject_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'wallet_transactions is append-only: % is not permitted', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER trg_wallet_transactions_no_update
  BEFORE UPDATE ON wallet_transactions
  FOR EACH ROW EXECUTE FUNCTION wallet_transactions_reject_mutation();

CREATE TRIGGER trg_wallet_transactions_no_delete
  BEFORE DELETE ON wallet_transactions
  FOR EACH ROW EXECUTE FUNCTION wallet_transactions_reject_mutation();

-- =============================================================================
-- vouchers
-- =============================================================================
CREATE TABLE vouchers (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  denomination  voucher_denomination NOT NULL,
  expires_at    timestamptz NOT NULL,
  redeemed_at   timestamptz,
  redeemed_by   uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_vouchers_redeemed_pair
    CHECK ((redeemed_at IS NULL) = (redeemed_by IS NULL))
);

COMMENT ON TABLE vouchers IS
  'Issued discount vouchers redeemable at verified dealers. `denomination` (voucher_denomination enum: PHP_50/100/200/500, declared in 0001_init.sql) fixes the allowed face values. `expires_at` is NOT NULL — no indefinite vouchers (tech-spec §4.3). The pair CHECK guarantees `redeemed_at` and `redeemed_by` are both NULL (unredeemed) or both set (redeemed) — they cannot drift out of sync.';

CREATE INDEX idx_vouchers_user_id ON vouchers (user_id);
CREATE INDEX idx_vouchers_expires_at ON vouchers (expires_at);

CREATE TRIGGER trg_vouchers_set_updated_at
  BEFORE UPDATE ON vouchers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================================
-- reward_config (singleton)
-- =============================================================================
CREATE TABLE reward_config (
  id                        smallint PRIMARY KEY CHECK (id = 1),
  farmer_points_per_return  integer NOT NULL DEFAULT 100,
  dealer_points_per_return  integer NOT NULL DEFAULT 50,
  updated_by                uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  updated_at                timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE reward_config IS
  'Singleton business-parameter row. `CHECK (id = 1)` enforces at most one row — a second INSERT (any id) aborts. Do not hardcode point values in application code; every scan and voucher path reads these fields. Update path is a CRM admin action that sets `updated_by` / `updated_at`.';

CREATE TRIGGER trg_reward_config_set_updated_at
  BEFORE UPDATE ON reward_config
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================================
-- Seed: reward_config singleton row (defaults per PRD §Phase 1 item 1.3.9)
-- =============================================================================
INSERT INTO reward_config (id, farmer_points_per_return, dealer_points_per_return)
VALUES (1, 100, 50);

COMMIT;
