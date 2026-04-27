-- 0009_wallet_rpc.sql — Atomic wallet credit for the container return-reward flow.
--
-- `finalize_return_reward` is called from apps/crm/lib/scan/claim.ts when the
-- farmer confirms the return (return_farmer scan step). It runs the following
-- operations in a single transaction, which is the only safe way to combine
-- a state-machine advance on `containers` with two wallet credits and the
-- deletion of the sidecar row:
--
--   1. Fetch + lock the pending_return_reward row (FOR UPDATE prevents two
--      concurrent farmer scans from both resolving the same pending record).
--   2. Read reward_config for point values (required; aborts if missing).
--   3. Credit the farmer wallet (INSERT ON CONFLICT DO UPDATE).
--   4. Append farmer wallet_transaction row.
--   5. Credit the dealer wallet.
--   6. Append dealer wallet_transaction row.
--   7. Advance containers.state from 'returned' → 'rewards_paid'.
--   8. Delete the pending_return_reward row (lazy cleanup; no cron needed).
--
-- Why a DB function instead of application code?
--   wallet_transactions is append-only; wallets.balance_points has a
--   non-negativity CHECK. If step 3 or 5 succeeds but the counterpart fails,
--   the ledger is corrupt. Only a server-side transaction guarantees atomicity.
--
-- Error codes used (ERRCODE matches Postgres class P0):
--   P0002 (no_data_found)  — pending row absent (already finalized or expired)
--   P0001 (raise_exception) — container not in expected state

BEGIN;

CREATE OR REPLACE FUNCTION finalize_return_reward(
  p_pending_id  uuid,
  p_farmer_id   uuid
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_container_id    uuid;
  v_dealer_user_id  uuid;
  v_farmer_pts      integer;
  v_dealer_pts      integer;
  v_rows_updated    integer;
BEGIN
  -- Step 1: lock the pending row and resolve dealer user_id.
  SELECT prr.container_id, da.user_id
    INTO v_container_id, v_dealer_user_id
    FROM pending_return_reward prr
    JOIN dealer_accounts da ON da.id = prr.dealer_id
   WHERE prr.id = p_pending_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'pending_return_reward % not found or already finalized', p_pending_id
      USING ERRCODE = 'no_data_found';
  END IF;

  -- Step 2: read reward config singleton.
  SELECT farmer_points_per_return, dealer_points_per_return
    INTO v_farmer_pts, v_dealer_pts
    FROM reward_config
   WHERE id = 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'reward_config singleton row is missing'
      USING ERRCODE = 'no_data_found';
  END IF;

  -- Step 3+4: credit farmer wallet. INSERT ON CONFLICT handles a first-earn
  -- farmer who has no wallet row yet (wallet is created on sign-up normally,
  -- but belt-and-suspenders here avoids a FK violation on wallet_transactions).
  INSERT INTO wallets (user_id, balance_points)
    VALUES (p_farmer_id, v_farmer_pts)
    ON CONFLICT (user_id) DO UPDATE
      SET balance_points = wallets.balance_points + v_farmer_pts,
          updated_at     = now();

  INSERT INTO wallet_transactions (user_id, delta, reason)
    VALUES (p_farmer_id, v_farmer_pts, 'farmer_return_reward');

  -- Step 5+6: credit dealer wallet.
  INSERT INTO wallets (user_id, balance_points)
    VALUES (v_dealer_user_id, v_dealer_pts)
    ON CONFLICT (user_id) DO UPDATE
      SET balance_points = wallets.balance_points + v_dealer_pts,
          updated_at     = now();

  INSERT INTO wallet_transactions (user_id, delta, reason)
    VALUES (v_dealer_user_id, v_dealer_pts, 'dealer_return_reward');

  -- Step 7: advance container state. The WHERE state='returned' guard is a
  -- second-layer idempotency check — if this function is called twice on the
  -- same pending_id the row-lock above will catch it first, but this prevents
  -- a rewards_paid container from ever being double-advanced.
  UPDATE containers
     SET state          = 'rewards_paid',
         rewards_paid_at = now()
   WHERE id    = v_container_id
     AND state = 'returned';

  GET DIAGNOSTICS v_rows_updated = ROW_COUNT;
  IF v_rows_updated = 0 THEN
    RAISE EXCEPTION 'container % is not in returned state — cannot finalize reward', v_container_id
      USING ERRCODE = 'raise_exception';
  END IF;

  -- Step 8: remove the sidecar row so the 60-min window is no longer live.
  DELETE FROM pending_return_reward WHERE id = p_pending_id;
END;
$$;

COMMIT;
