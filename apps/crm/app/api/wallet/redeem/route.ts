export const runtime = 'nodejs'

import { type NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { z } from 'zod'
import { createServerClient, createServiceClient } from '@gaia/supabase'
import { reqId, errorResponse } from '@/lib/api'
import { checkIdempotency, storeIdempotency } from '@/lib/scan/idempotency'

const bodySchema = z.object({
  denomination: z.enum(['PHP_50', 'PHP_100', 'PHP_200', 'PHP_500']),
  idempotency_key: z.string().uuid(),
})

export async function POST(request: NextRequest): Promise<NextResponse> {
  const rid = reqId()
  const cookieStore = cookies()
  const supabase = createServerClient(cookieStore)

  // ── Auth — farmer JWT required ────────────────────────────────────────────
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return errorResponse(401, 'AUTH_REQUIRED', 'i18n:errors.auth_required', rid)
  }

  const role = user.app_metadata?.['user_role'] as string | undefined
  if (role !== 'farmer') {
    return errorResponse(403, 'FORBIDDEN', 'i18n:errors.forbidden', rid)
  }

  // ── Parse body ────────────────────────────────────────────────────────────
  let body: z.infer<typeof bodySchema>
  try {
    body = bodySchema.parse(await request.json())
  } catch {
    return errorResponse(400, 'VALIDATION_FAILED', 'i18n:errors.validation_failed', rid)
  }

  const service = createServiceClient()

  // ── Idempotency check ─────────────────────────────────────────────────────
  const cached = await checkIdempotency(body.idempotency_key, user.id, service).catch(() => null)
  if (cached !== null) {
    return NextResponse.json(cached)
  }

  // ── Redeem via atomic SQL function ────────────────────────────────────────
  const { data, error } = await service.rpc('redeem_voucher', {
    p_user_id: user.id,
    p_denomination: body.denomination,
  })

  if (error) {
    if (error.message.includes('insufficient_points')) {
      const match = error.message.match(/required=(\d+) available=(\d+)/)
      return errorResponse(400, 'INSUFFICIENT_POINTS', 'i18n:errors.insufficient_points', rid, {
        required: match ? parseInt(match[1]!, 10) : null,
        available: match ? parseInt(match[2]!, 10) : null,
      })
    }
    if (error.message.includes('not configured in reward_config') || error.code === '22023') {
      return errorResponse(400, 'INVALID_DENOMINATION', 'i18n:errors.invalid_denomination', rid)
    }
    if (error.code === 'P0002') {
      return errorResponse(404, 'WALLET_NOT_FOUND', 'i18n:errors.wallet_not_found', rid)
    }
    console.error('[api/wallet/redeem] rpc error', { rid, message: error.message, code: error.code })
    return errorResponse(500, 'INTERNAL_ERROR', 'i18n:errors.internal_error', rid)
  }

  const row = (Array.isArray(data) ? data[0] : data) as
    | { voucher_code: string; new_balance: number }
    | null

  if (!row) {
    console.error('[api/wallet/redeem] rpc returned no row', { rid })
    return errorResponse(500, 'INTERNAL_ERROR', 'i18n:errors.internal_error', rid)
  }

  const responseBody = {
    data: {
      voucher_code: row.voucher_code,
      denomination: body.denomination,
      remaining_balance_points: row.new_balance,
      created_at: new Date().toISOString(),
    },
    meta: { request_id: rid },
  }

  await storeIdempotency(body.idempotency_key, user.id, responseBody, service).catch(() => {})

  return NextResponse.json(responseBody)
}
