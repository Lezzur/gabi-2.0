-- 0012_wallet_redeem.sql — Voucher redemption: code storage + atomic SQL function.
--
-- Adds two things:
--   1. `vouchers.code_hash` — SHA-256 of the plaintext code. The plaintext is
--      returned to the caller ONCE and never persisted; only the hash is stored.
--      A separate UNIQUE index prevents two vouchers from sharing the same code.
--   2. `redeem_voucher(p_user_id, p_denomination)` — atomic PL/pgSQL function
--      that locks the wallet row, checks the balance, deducts points, appends a
--      wallet_transaction, generates a cryptographically random voucher code,
--      inserts the voucher row, and returns the plaintext code + new balance.
--      All in one transaction: the caller cannot observe a deducted wallet with
--      no voucher row, or a voucher row with no corresponding wallet debit.
--
-- Denomination point costs are stored in `reward_config` so GAIA admins can
-- adjust them without a code deploy. Four new columns are added (one per
-- denomination) with conservative defaults.
--
-- Voucher code alphabet: ABCDEFGHJKLMNPQRSTUVWXYZ23456789 — 32 chars, no
-- visually ambiguous characters (0/O, 1/I). 16-char code → 80 bits of
-- entropy, enough to prevent brute-force guessing (10^15 combinations).
-- Generated with gen_random_bytes(16); each byte mod 32 is unbiased because
-- 256 is an exact multiple of 32.

BEGIN;

-- ── 1. vouchers.code_hash column ─────────────────────────────────────────────
ALTER TABLE vouchers
  ADD COLUMN IF NOT EXISTS code_hash text;

CREATE UNIQUE INDEX IF NOT EXISTS uq_vouchers_code_hash ON vouchers (code_hash)
  WHERE code_hash IS NOT NULL;

-- ── 2. Denomination cost columns on reward_config ────────────────────────────
-- Point costs are intentionally generous defaults: 10 points per PHP of face
-- value (e.g. PHP 50 voucher costs 500 points). Admins update via CRM.
ALTER TABLE reward_config
  ADD COLUMN IF NOT EXISTS voucher_cost_php_50  integer NOT NULL DEFAULT 500  CHECK (voucher_cost_php_50  >= 0),
  ADD COLUMN IF NOT EXISTS voucher_cost_php_100 integer NOT NULL DEFAULT 1000 CHECK (voucher_cost_php_100 >= 0),
  ADD COLUMN IF NOT EXISTS voucher_cost_php_200 integer NOT NULL DEFAULT 2000 CHECK (voucher_cost_php_200 >= 0),
  ADD COLUMN IF NOT EXISTS voucher_cost_php_500 integer NOT NULL DEFAULT 5000 CHECK (voucher_cost_php_500 >= 0);

-- ── 3. redeem_voucher function ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION redeem_voucher(
  p_user_id     uuid,
  p_denomination voucher_denomination
)
RETURNS TABLE (voucher_code text, new_balance integer)
LANGUAGE plpgsql
AS $$
DECLARE
  v_cost            integer;
  v_current_balance integer;
  v_alphabet        CONSTANT text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_raw             bytea;
  v_code            text := '';
  v_code_hash       text;
  v_expires_at      timestamptz;
  i                 integer;
BEGIN
  -- Resolve point cost from reward_config singleton.
  SELECT
    CASE p_denomination
      WHEN 'PHP_50'  THEN voucher_cost_php_50
      WHEN 'PHP_100' THEN voucher_cost_php_100
      WHEN 'PHP_200' THEN voucher_cost_php_200
      WHEN 'PHP_500' THEN voucher_cost_php_500
      ELSE NULL
    END
    INTO v_cost
    FROM reward_config
   WHERE id = 1;

  IF v_cost IS NULL THEN
    RAISE EXCEPTION 'denomination % is not configured in reward_config', p_denomination
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Lock the wallet row to serialise concurrent redemptions.
  SELECT balance_points
    INTO v_current_balance
    FROM wallets
   WHERE user_id = p_user_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'wallet not found for user %', p_user_id
      USING ERRCODE = 'no_data_found';
  END IF;

  IF v_current_balance < v_cost THEN
    -- Caller maps this SQLSTATE to HTTP 400 INSUFFICIENT_POINTS.
    RAISE EXCEPTION 'insufficient_points: required=% available=%', v_cost, v_current_balance
      USING ERRCODE = 'check_violation';
  END IF;

  -- Deduct balance.
  UPDATE wallets
     SET balance_points = balance_points - v_cost,
         updated_at     = now()
   WHERE user_id = p_user_id;

  -- Append wallet transaction (append-only — INSERT only).
  INSERT INTO wallet_transactions (user_id, delta, reason)
    VALUES (p_user_id, -v_cost, 'voucher_redemption');

  -- Generate 16-char code from 32-char unambiguous alphabet.
  -- Each byte mod 32 is uniform because 256 = 32 × 8 (no modulo bias).
  v_raw := gen_random_bytes(16);
  FOR i IN 0..15 LOOP
    v_code := v_code || substr(v_alphabet, (get_byte(v_raw, i) % 32) + 1, 1);
  END LOOP;

  v_code_hash  := encode(sha256(v_code::bytea), 'hex');
  v_expires_at := now() + INTERVAL '90 days';

  -- Insert voucher row (plaintext code is NOT stored — only the hash).
  INSERT INTO vouchers (user_id, denomination, expires_at, code_hash)
    VALUES (p_user_id, p_denomination, v_expires_at, v_code_hash);

  RETURN QUERY
    SELECT v_code,
           (SELECT balance_points FROM wallets WHERE user_id = p_user_id);
END;
$$;

COMMIT;
