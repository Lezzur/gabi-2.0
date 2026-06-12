import { type NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@gaia/supabase'
import { reqId, errorResponse } from '@/lib/api'
import { getRequestUser } from '@/lib/auth/request'
import { listVoucherTypes, mapTransaction } from '@/lib/wallet/farmer'

// GET /api/wallets/me — the authenticated user's own wallet (api-spec §10.1).
// Returns balance, the 20 most recent transactions, and the redeemable
// voucher types synthesized from reward_config denominations.
export async function GET(request: NextRequest): Promise<NextResponse> {
  const rid = reqId()

  const user = await getRequestUser(request)
  if (!user) {
    return errorResponse(401, 'AUTH_REQUIRED', 'i18n:errors.auth_required', rid)
  }

  const service = createServiceClient()

  const [walletResult, txResult, voucherTypes] = await Promise.all([
    service
      .from('wallets')
      .select('id, user_id, balance_points, updated_at')
      .eq('user_id', user.id)
      .maybeSingle(),
    service
      .from('wallet_transactions')
      .select('id, delta, reason, created_at, scan_attempts(container_id)')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(20),
    listVoucherTypes(service),
  ])

  if (walletResult.error !== null) {
    console.error('[api/wallets/me] wallet fetch failed', { rid, message: walletResult.error.message })
    return errorResponse(500, 'INTERNAL_ERROR', 'i18n:errors.internal_error', rid)
  }
  if (walletResult.data === null) {
    return errorResponse(404, 'NOT_FOUND', 'Wallet not found.', rid)
  }
  if (txResult.error !== null) {
    console.error('[api/wallets/me] transactions fetch failed', { rid, message: txResult.error.message })
    return errorResponse(500, 'INTERNAL_ERROR', 'i18n:errors.internal_error', rid)
  }
  if (voucherTypes === null) {
    console.error('[api/wallets/me] reward_config fetch failed', { rid })
    return errorResponse(500, 'INTERNAL_ERROR', 'i18n:errors.internal_error', rid)
  }

  const wallet = walletResult.data

  return NextResponse.json({
    data: {
      id: wallet.id,
      user_id: wallet.user_id,
      balance_points: wallet.balance_points,
      transactions: txResult.data.map(mapTransaction),
      vouchers: voucherTypes,
      updated_at: wallet.updated_at,
    },
    meta: { request_id: rid },
  })
}
