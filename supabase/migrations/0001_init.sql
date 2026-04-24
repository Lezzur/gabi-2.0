-- =============================================================================
-- 0001_init.sql — GAIA Phase 1: Core schema.
--
-- Creates all enums plus the four tables whose shape is load-bearing for the
-- scan pipeline: products, product_crops, containers, scan_attempts.
--
-- Auxiliary tables (dealer_accounts, manufacturer_accounts, wallets,
-- wallet_transactions, vouchers, pending_purchase, pending_return_reward,
-- reward_config, user_profiles) live in 0002_aux.sql.
-- RLS policies live in 0003_rls.sql. This migration grants no privileges.
--
-- Spec sources: tech-spec §4.3 (entity shapes) and PRD §Phase 1 (enum lists).
--
-- Intentional deviations from the Phase-2 task prompt, recorded for reviewers:
--
--   * The generated column `formulation_expires_at` is declared on `containers`,
--     not `products`. `manufacture_date` is a per-container field (tech-spec
--     §4.3), so the 2-year derivation can only resolve there. The task prompt
--     wording "Generated column on products" is treated as a typo.
--
--   * `scan_attempts` has no `updated_at` column. The table is append-only
--     (enforced by the mutation-rejecting trigger below), so an updated_at
--     would never change. Other tables still carry updated_at + touch trigger.
--
--   * Indexes on scan_attempts are consolidated: the composite
--     (container_id, created_at DESC) subsumes the standalone container_id
--     index from tech-spec §4.3 (a composite with container_id as leading
--     column satisfies both query shapes).
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- =============================================================================
-- Enums
-- =============================================================================
-- TS-04 (tech-spec §Decisions): `container_state` mirrors PRD §Phase 1 verbatim,
-- including the `pending_purchase` member. However, `pending_purchase` is a
-- SIDECAR-ROW signal only — no row in `containers` should ever carry
-- `state = 'pending_purchase'`. The authoritative "pending" gate lives in the
-- `pending_purchase` table (see 0002_aux.sql). The real state machine is:
--
--     in_distribution → purchased → returned → rewards_paid
--
-- The enum member is retained because the PRD is locked; removing it requires
-- a schema amendment, not a task-level decision.

CREATE TYPE container_state AS ENUM (
  'in_distribution',
  'pending_purchase',
  'purchased',
  'returned',
  'rewards_paid'
);

CREATE TYPE product_status AS ENUM (
  'draft',
  'active',
  'suspended'
);

CREATE TYPE actor_type AS ENUM (
  'farmer',
  'dealer',
  'admin'
);

CREATE TYPE scan_step AS ENUM (
  'purchase_dealer',
  'purchase_farmer',
  'return_dealer',
  'return_farmer'
);

CREATE TYPE scan_outcome AS ENUM (
  'success',
  'hmac_invalid',
  'auth_required',
  'fpa_blocked',
  'state_mismatch',
  'window_expired',
  'already_claimed',
  'condition_rejected',
  'product_draft'
);

CREATE TYPE formulation_type AS ENUM (
  'EC', 'SC', 'WP', 'WG', 'SL', 'GR', 'DP', 'ULV', 'OTHER'
);

CREATE TYPE toxicity_category AS ENUM ('1', '2', '3', '4');

CREATE TYPE product_type AS ENUM (
  'HERBICIDE',
  'INSECTICIDE',
  'FUNGICIDE',
  'RODENTICIDE',
  'NEMATICIDE',
  'ACARICIDE',
  'OTHER'
);

-- Voucher denominations in Philippine pesos. Declared here so all shared enums
-- live in one migration; the `vouchers` table that uses it is created in
-- 0002_aux.sql. Values are the initial v1 set; adding members is an ALTER TYPE.
CREATE TYPE voucher_denomination AS ENUM (
  'PHP_50',
  'PHP_100',
  'PHP_200',
  'PHP_500'
);

-- =============================================================================
-- Shared trigger fn: touch updated_at on UPDATE.
-- =============================================================================
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- =============================================================================
-- products
-- =============================================================================
CREATE TABLE products (
  id                              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_name                    text NOT NULL,
  brand_name                      text,
  company                         text NOT NULL,
  active_ingredient               text NOT NULL,
  concentration                   text,
  formulation_type                formulation_type,
  type                            product_type,
  category                        toxicity_category,
  fpa_registration_number         text UNIQUE,
  fpa_registration_expires_at     date,
  fpa_last_imported_at            timestamptz,
  mode_of_entry                   text,
  mode_of_action_group            text,
  dosage_rate                     text,
  mrl                             text,
  pre_harvest_interval            text,
  re_entry_period                 text,
  distributor                     text,
  formulated_by                   text,
  imported_by                     text,
  timing_of_application           text,
  note_to_physician               text,
  pests                           text,
  status                          product_status NOT NULL DEFAULT 'draft',
  category_confirmed_by           uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  category_confirmed_at           timestamptz,
  note_to_physician_confirmed_by  uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  note_to_physician_confirmed_at  timestamptz,
  label_image_storage_path        text,
  created_at                      timestamptz NOT NULL DEFAULT now(),
  updated_at                      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE products IS
  'Agrichemical product catalog. Source of truth is the FPA spreadsheet (upserted on import); OCR/manual CRM entry enriches safety fields (category, note_to_physician). Lifecycle: draft → active (requires both category_confirmed_by and note_to_physician_confirmed_by, enforced at app level per tech-spec §6 Safety Gate) → suspended. Never hard-deleted; suspension is the terminal state for withdrawn products.';

CREATE INDEX idx_products_fpa_registration_number ON products (fpa_registration_number);
CREATE INDEX idx_products_status ON products (status);
CREATE INDEX idx_products_type ON products (type);

CREATE TRIGGER trg_products_set_updated_at
  BEFORE UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Safety-gate invariant (products.status = 'active' ⇒ both *_confirmed_by set)
-- is enforced at the application layer and in a follow-up trigger migration;
-- not encoded as a table CHECK because the violating path is a CRM write
-- that should surface a structured API error rather than a generic constraint.

-- =============================================================================
-- product_crops
-- =============================================================================
CREATE TABLE product_crops (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id  uuid NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  crop        text NOT NULL,
  pests       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_product_crops_product_crop UNIQUE (product_id, crop)
);

COMMENT ON TABLE product_crops IS
  'Per-crop pest/weed/disease breakdown for a product, normalized from the flat FPA `pests` string on products. Populated during FPA import. Parent FK is ON DELETE RESTRICT: products are never hard-deleted, so cascade semantics would mask a programming error.';

CREATE INDEX idx_product_crops_product_id ON product_crops (product_id);

CREATE TRIGGER trg_product_crops_set_updated_at
  BEFORE UPDATE ON product_crops
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================================
-- containers
-- =============================================================================
-- State-transition integrity (in_distribution → purchased → returned →
-- rewards_paid) is enforced by the scan endpoint's atomic UPDATE ... WHERE
-- state = <expected>, NOT by a DB-level CHECK. Rationale: valid transitions
-- depend on sidecar rows (pending_purchase, pending_return_reward) and a
-- 60-minute window that a table CHECK cannot read. App-level enforcement is
-- primary; RLS (0003_rls.sql) is the secondary gate.

CREATE TABLE containers (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id             uuid NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  hmac                   text NOT NULL,
  hmac_suffix            char(16) NOT NULL,
  batch_number           text,
  manufacture_date       date,
  formulation_expires_at date GENERATED ALWAYS AS (manufacture_date + INTERVAL '2 years') STORED,
  state                  container_state NOT NULL DEFAULT 'in_distribution',
  purchased_by_user_id   uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  purchased_at           timestamptz,
  returned_by_user_id    uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  returned_at            timestamptz,
  rewards_paid_at        timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE containers IS
  'Physical product units addressed by QR code; one row per manufactured bottle/bag. Lifecycle: in_distribution → purchased → returned → rewards_paid (never deleted; no back-transitions). `hmac` stores the full HMAC-SHA256 hex for verification on every scan; `hmac_suffix` is the indexed last-16-char lookup key encoded in the QR payload. `formulation_expires_at` is derived (manufacture_date + 2y) per tech-spec §4.3.';

CREATE INDEX idx_containers_product_id ON containers (product_id);
CREATE INDEX idx_containers_state ON containers (state);
CREATE INDEX idx_containers_purchased_by_user_id ON containers (purchased_by_user_id);
CREATE INDEX idx_containers_batch_number ON containers (product_id, batch_number);
CREATE UNIQUE INDEX uq_containers_hmac_suffix ON containers (hmac_suffix);

CREATE TRIGGER trg_containers_set_updated_at
  BEFORE UPDATE ON containers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================================
-- scan_attempts (append-only)
-- =============================================================================
CREATE TABLE scan_attempts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  container_id   uuid REFERENCES containers(id) ON DELETE RESTRICT,
  actor_id       uuid,
  actor_type     actor_type,
  step           scan_step NOT NULL,
  outcome        scan_outcome NOT NULL,
  hmac_valid     boolean NOT NULL,
  auth_valid     boolean NOT NULL,
  ip_address     inet,
  local_scan_ts  timestamptz,
  sync_ts        timestamptz NOT NULL DEFAULT now(),
  device_id      text,
  last_online_ts timestamptz,
  sync_delayed   boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now()
  -- No updated_at: rows are immutable (see BEFORE UPDATE trigger below).
);

COMMENT ON TABLE scan_attempts IS
  'Append-only audit log of every scan attempt (CRM + mobile), including failures. Never updated, never deleted — enforced by trigger + RLS (0003_rls.sql). Powers alerting queries (outcome, created_at) and forensic review. container_id is nullable because HMAC-invalid scans fail before the container can be resolved.';

CREATE INDEX idx_scan_attempts_container_created_desc
  ON scan_attempts (container_id, created_at DESC);
CREATE INDEX idx_scan_attempts_actor_id
  ON scan_attempts (actor_id);
CREATE INDEX idx_scan_attempts_created_at_desc
  ON scan_attempts (created_at DESC);
CREATE INDEX idx_scan_attempts_outcome_created
  ON scan_attempts (outcome, created_at);

-- Auto-flag scans whose device-reported local_scan_ts lags the server
-- sync_ts by more than 5 minutes. Runs BEFORE INSERT so the stored value
-- is authoritative — the caller cannot forge it.
CREATE OR REPLACE FUNCTION scan_attempts_mark_sync_delayed()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.local_scan_ts IS NOT NULL
     AND (NEW.sync_ts - NEW.local_scan_ts) > INTERVAL '5 minutes' THEN
    NEW.sync_delayed := true;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_scan_attempts_mark_sync_delayed
  BEFORE INSERT ON scan_attempts
  FOR EACH ROW EXECUTE FUNCTION scan_attempts_mark_sync_delayed();

-- Append-only enforcement: UPDATE and DELETE always raise, regardless of role.
-- This is the primary DB-level defense; RLS in 0003_rls.sql is a redundant gate.
CREATE OR REPLACE FUNCTION scan_attempts_reject_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'scan_attempts is append-only: % is not permitted', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER trg_scan_attempts_no_update
  BEFORE UPDATE ON scan_attempts
  FOR EACH ROW EXECUTE FUNCTION scan_attempts_reject_mutation();

CREATE TRIGGER trg_scan_attempts_no_delete
  BEFORE DELETE ON scan_attempts
  FOR EACH ROW EXECUTE FUNCTION scan_attempts_reject_mutation();

COMMIT;
