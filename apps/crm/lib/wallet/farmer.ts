import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@gaia/supabase'

// Bridges the farmer-facing wallet API (api-spec §10) onto the
// denomination-based voucher model (0013_wallet_redeem.sql): voucher "types"
// are the four PHP denominations priced by the reward_config singleton, and
// `voucher_type_id` in requests is the denomination key itself.

export const VOUCHER_DENOMINATIONS = ['PHP_50', 'PHP_100', 'PHP_200', 'PHP_500'] as const
export type VoucherDenomination = (typeof VOUCHER_DENOMINATIONS)[number]

export const VOUCHER_VALIDITY_DAYS = 90 // mirrors redeem_voucher()'s 90-day interval

const DENOMINATION_VALUE: Record<VoucherDenomination, number> = {
  PHP_50: 50,
  PHP_100: 100,
  PHP_200: 200,
  PHP_500: 500,
}

interface VoucherType {
  id: VoucherDenomination
  points_cost: number
  discount_value: number
  description: string
  redeemed: boolean
  expires_at: string
}

/**
 * Synthesizes the redeemable voucher types from the reward_config singleton.
 * Returns null when the config row cannot be read.
 */
export async function listVoucherTypes(
  service: SupabaseClient<Database>,
): Promise<VoucherType[] | null> {
  const { data, error } = await service
    .from('reward_config')
    .select('voucher_cost_php_50, voucher_cost_php_100, voucher_cost_php_200, voucher_cost_php_500')
    .eq('id', 1)
    .maybeSingle()

  if (error !== null || data === null) return null

  const costs: Record<VoucherDenomination, number> = {
    PHP_50: data.voucher_cost_php_50,
    PHP_100: data.voucher_cost_php_100,
    PHP_200: data.voucher_cost_php_200,
    PHP_500: data.voucher_cost_php_500,
  }

  const expiresAt = new Date(Date.now() + VOUCHER_VALIDITY_DAYS * 86_400_000).toISOString()

  return VOUCHER_DENOMINATIONS.map((d) => ({
    id: d,
    points_cost: costs[d],
    discount_value: DENOMINATION_VALUE[d],
    description: `PHP ${DENOMINATION_VALUE[d]} discount at participating dealers`,
    redeemed: false,
    expires_at: expiresAt,
  }))
}

export function denominationValue(d: VoucherDenomination): number {
  return DENOMINATION_VALUE[d]
}

const REASON_DESCRIPTIONS: Record<string, string> = {
  farmer_return_reward: 'Return reward',
  dealer_return_reward: 'Return reward',
  voucher_redemption: 'Voucher redemption',
  manual_adjustment: 'Points adjustment',
}

interface TransactionRow {
  id: string
  delta: number
  reason: string
  created_at: string
  // PostgREST embeds the scan_attempts FK relation as an object (or null
  // when scan_attempt_id is null, e.g. voucher redemptions).
  scan_attempts: { container_id: string | null } | null
}

/** Maps a wallet_transactions row to the mobile/api-spec transaction shape. */
export function mapTransaction(row: TransactionRow) {
  return {
    id: row.id,
    container_id: row.scan_attempts?.container_id ?? null,
    points: row.delta,
    description: REASON_DESCRIPTIONS[row.reason] ?? row.reason,
    created_at: row.created_at,
  }
}
