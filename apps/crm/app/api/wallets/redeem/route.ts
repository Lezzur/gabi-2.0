export const runtime = 'nodejs'

import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createServiceClient } from '@gaia/supabase'
import { reqId, errorResponse } from '@/lib/api'
import { getRequestUser } from '@/lib/auth/request'
import {
  VOUCHER_DENOMINATIONS,
  VOUCHER_VALIDITY_DAYS,
  denominationValue,
  listVoucherTypes,
} from '@/lib/wallet/farmer'

// POST /api/wallets/redeem — farmer-facing voucher redemption (api-spec §10.3).
// `voucher_type_id` is a denomination key (see lib/wallet/farmer.ts); the
// atomic redeem_voucher RPC does the balance check, debit, and voucher insert.
const bodySchema = z.object({
  voucher_type_id: z.enum(VOUCHER_DENOMINATIONS),
})

export async function POST(request: NextRequest): Promise<NextResponse> {
  const rid = reqId()

  const user = await getRequestUser(request)
  if (!user) {
    return errorResponse(401, 'AUTH_REQUIRED', 'i18n:errors.auth_required', rid)
  }

  let body: z.infer<typeof bodySchema>
  try {
    body = bodySchema.parse(await request.json())
  } catch {
    return errorResponse(400, 'VALIDATION_FAILED', 'i18n:errors.validation_failed', rid)
  }

  const service = createServiceClient()
  const denomination = body.voucher_type_id

  const { data, error } = await service.rpc('redeem_voucher', {
    p_user_id: user.id,
    p_denomination: denomination,
  })

  if (error) {
    if (error.message.includes('insufficient_points')) {
      const match = error.message.match(/required=(\d+) available=(\d+)/)
      return errorResponse(422, 'UNPROCESSABLE', 'i18n:errors.insufficient_points', rid, {
        required: match ? parseInt(match[1]!, 10) : null,
        available: match ? parseInt(match[2]!, 10) : null,
      })
    }
    if (error.message.includes('not configured in reward_config') || error.code === '22023') {
      return errorResponse(400, 'VALIDATION_FAILED', 'i18n:errors.invalid_denomination', rid)
    }
    if (error.code === 'P0002') {
      return errorResponse(404, 'WALLET_NOT_FOUND', 'i18n:errors.wallet_not_found', rid)
    }
    console.error('[api/wallets/redeem] rpc error', { rid, message: error.message, code: error.code })
    return errorResponse(500, 'INTERNAL_ERROR', 'i18n:errors.internal_error', rid)
  }

  const row = (Array.isArray(data) ? data[0] : data) as
    | { voucher_code: string; new_balance: number }
    | null

  if (!row) {
    console.error('[api/wallets/redeem] rpc returned no row', { rid })
    return errorResponse(500, 'INTERNAL_ERROR', 'i18n:errors.internal_error', rid)
  }

  // points_deducted comes from reward_config, read after the fact — the RPC
  // already debited using the same row, so the values agree.
  const voucherTypes = await listVoucherTypes(service)
  const pointsDeducted = voucherTypes?.find(v => v.id === denomination)?.points_cost ?? null

  return NextResponse.json(
    {
      data: {
        voucher_id: row.voucher_code,
        points_deducted: pointsDeducted,
        new_balance: row.new_balance,
        discount_value: denominationValue(denomination),
        expires_at: new Date(Date.now() + VOUCHER_VALIDITY_DAYS * 86_400_000).toISOString(),
        qr_data: `voucher:${row.voucher_code}`,
      },
      meta: { request_id: rid },
    },
    { status: 201 },
  )
}
