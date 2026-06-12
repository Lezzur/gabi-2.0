import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createServiceClient } from '@gaia/supabase'
import { reqId, errorResponse, encodeCursor, decodeCursor } from '@/lib/api'
import { getRequestUser } from '@/lib/auth/request'
import { mapTransaction } from '@/lib/wallet/farmer'

const querySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
})

// GET /api/wallets/me/transactions — cursor-paginated transaction history
// for the authenticated user (api-spec §10.2).
export async function GET(request: NextRequest): Promise<NextResponse> {
  const rid = reqId()

  const user = await getRequestUser(request)
  if (!user) {
    return errorResponse(401, 'AUTH_REQUIRED', 'i18n:errors.auth_required', rid)
  }

  const raw = Object.fromEntries(request.nextUrl.searchParams)
  const parsed = querySchema.safeParse(raw)
  if (!parsed.success) {
    return errorResponse(
      400,
      'VALIDATION_FAILED',
      'i18n:errors.validation_failed',
      rid,
      parsed.error.issues.map(i => ({ field: String(i.path[0] ?? ''), issue: i.message })),
    )
  }

  const { cursor, limit } = parsed.data

  let cursorData: { c: string; i: string } | null = null
  if (cursor) {
    cursorData = decodeCursor(cursor)
    if (!cursorData) {
      return errorResponse(400, 'INVALID_CURSOR', 'i18n:errors.invalid_cursor', rid)
    }
  }

  const service = createServiceClient()

  let txQuery = service
    .from('wallet_transactions')
    .select('id, delta, reason, created_at, scan_attempts(container_id)')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit + 1)

  if (cursorData) {
    txQuery = txQuery.or(
      `created_at.lt.${cursorData.c},and(created_at.eq.${cursorData.c},id.lt.${cursorData.i})`,
    )
  }

  const { data, error } = await txQuery

  if (error !== null) {
    console.error('[api/wallets/me/transactions] fetch failed', { rid, message: error.message })
    return errorResponse(500, 'INTERNAL_ERROR', 'i18n:errors.internal_error', rid)
  }

  const hasMore = data.length > limit
  const items = hasMore ? data.slice(0, limit) : data
  const last = items.at(-1)
  const nextCursor = hasMore && last ? encodeCursor(last.created_at, last.id) : null

  return NextResponse.json({
    data: items.map(mapTransaction),
    pagination: { next_cursor: nextCursor, has_more: hasMore },
    meta: { request_id: rid },
  })
}
