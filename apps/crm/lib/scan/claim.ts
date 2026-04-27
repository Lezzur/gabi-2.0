// Atomic state-transition helpers for the scan pipeline.
//
// Each function issues a single UPDATE...WHERE...RETURNING statement so the
// claim is atomic — no SELECT-then-UPDATE races. The caller (scan route) opens
// no outer transaction; atomicity is per-statement or delegated to a Postgres
// function (finalizeReturnReward → finalize_return_reward RPC).
//
// Logging convention: log UUID prefix (first 8 chars) and actor ID only.
// Never log full HMAC values or phone numbers.

import type { SupabaseClient } from '@supabase/supabase-js'

export type ClaimResult =
  | { claimed: true }
  | { claimed: false; reason: 'ALREADY_CLAIMED' }

export type PendingReturnResult =
  | { written: true; pending_id: string }
  | { written: false; reason: 'ALREADY_CLAIMED' }

export type FinalizeResult =
  | { finalized: true }
  | { finalized: false; reason: 'PENDING_NOT_FOUND' | 'CONTAINER_STATE_MISMATCH' }

function uuidPrefix(id: string): string {
  return id.slice(0, 8)
}

/**
 * Transitions container in_distribution → purchased.
 * The WHERE state='in_distribution' AND purchased_by_user_id IS NULL guard is
 * the sole race protection — if two concurrent requests arrive for the same
 * container, exactly one will match one row; the other returns { claimed: false }.
 */
export async function claimPurchaseByFarmer(
  containerId: string,
  farmerId: string,
  scanTs: string,
  client: SupabaseClient,
): Promise<ClaimResult> {
  const { data, error } = await client
    .from('containers')
    .update({
      state: 'purchased',
      purchased_by_user_id: farmerId,
      purchased_at: scanTs,
    })
    .eq('id', containerId)
    .eq('state', 'in_distribution')
    .is('purchased_by_user_id', null)
    .select('id')

  if (error) {
    throw new Error(
      `[scan/claim] claimPurchaseByFarmer container=${uuidPrefix(containerId)}: ${error.message}`,
      { cause: error },
    )
  }

  if (!data || data.length === 0) return { claimed: false, reason: 'ALREADY_CLAIMED' }
  return { claimed: true }
}

/**
 * Transitions container purchased → returned.
 * dealerUserId is the authenticated dealer's auth.users.id — stored in
 * returned_by_user_id as both an actor record and the concurrency lock guard.
 * dealerAccountId is dealer_accounts.id — stored in return_dealer_id for
 * downstream queries (e.g. label-export, reward audit).
 */
export async function claimReturnByDealer(
  containerId: string,
  dealerUserId: string,
  dealerAccountId: string,
  scanTs: string,
  client: SupabaseClient,
): Promise<ClaimResult> {
  const { data, error } = await client
    .from('containers')
    .update({
      state: 'returned',
      returned_by_user_id: dealerUserId,
      return_dealer_id: dealerAccountId,
      returned_at: scanTs,
    })
    .eq('id', containerId)
    .eq('state', 'purchased')
    .is('returned_by_user_id', null)
    .select('id')

  if (error) {
    throw new Error(
      `[scan/claim] claimReturnByDealer container=${uuidPrefix(containerId)}: ${error.message}`,
      { cause: error },
    )
  }

  if (!data || data.length === 0) return { claimed: false, reason: 'ALREADY_CLAIMED' }
  return { claimed: true }
}

/**
 * Opens the 60-minute return-reward window by inserting a pending_return_reward row.
 * The UNIQUE constraint on container_id is the idempotency guard — a duplicate
 * insert (unique-violation error code 23505) is treated as a repeat and returns
 * { written: false, reason: 'ALREADY_CLAIMED' } rather than throwing.
 */
export async function writePendingReturnReward(
  containerId: string,
  dealerAccountId: string,
  client: SupabaseClient,
): Promise<PendingReturnResult> {
  const { data, error } = await client
    .from('pending_return_reward')
    .insert({ container_id: containerId, dealer_id: dealerAccountId })
    .select('id')
    .single()

  if (error) {
    if (error.code === '23505') return { written: false, reason: 'ALREADY_CLAIMED' }
    throw new Error(
      `[scan/claim] writePendingReturnReward container=${uuidPrefix(containerId)}: ${error.message}`,
      { cause: error },
    )
  }

  return { written: true, pending_id: data.id as string }
}

/**
 * Finalizes the return reward by calling the finalize_return_reward Postgres
 * function (0009_wallet_rpc.sql). The RPC atomically: credits both wallets,
 * appends wallet_transactions, advances container to rewards_paid, and removes
 * the sidecar pending row — all in one transaction.
 *
 * Postgres error codes surfaced as typed rejections:
 *   P0002 (no_data_found) — pending row missing or already finalized.
 *   P0001 (raise_exception) — container not in 'returned' state.
 */
export async function finalizeReturnReward(
  pendingId: string,
  farmerId: string,
  client: SupabaseClient,
): Promise<FinalizeResult> {
  const { error } = await client.rpc('finalize_return_reward', {
    p_pending_id: pendingId,
    p_farmer_id: farmerId,
  })

  if (error) {
    if (error.code === 'P0002') return { finalized: false, reason: 'PENDING_NOT_FOUND' }
    if (error.code === 'P0001') return { finalized: false, reason: 'CONTAINER_STATE_MISMATCH' }
    throw new Error(
      `[scan/claim] finalizeReturnReward pending=${uuidPrefix(pendingId)}: ${error.message}`,
      { cause: error },
    )
  }

  return { finalized: true }
}
