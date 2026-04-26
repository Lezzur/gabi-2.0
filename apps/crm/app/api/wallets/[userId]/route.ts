import { type NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { z } from 'zod'
import { createServerClient } from '@gaia/supabase'
import { reqId, errorResponse, encodeCursor, decodeCursor } from '@/lib/api'

const querySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
})

export async function GET(
  request: NextRequest,
  { params }: { params: { userId: string } },
): Promise<NextResponse> {
  const rid = reqId()

  // ── Auth ───────────────────────────────────────────────────────────────────
  const cookieStore = cookies()
  const supabase = createServerClient(cookieStore)
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return errorResponse(401, 'AUTH_REQUIRED', 'i18n:errors.auth_required', rid)
  }

  const role = user.app_metadata?.['user_role'] as string | undefined
  if (role !== 'gabs_admin') {
    return errorResponse(403, 'FORBIDDEN', 'i18n:errors.forbidden', rid)
  }

  // ── Query param validation ─────────────────────────────────────────────────
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
  const { userId } = params

  // ── Cursor decode ──────────────────────────────────────────────────────────
  let cursorData: { c: string; i: string } | null = null
  if (cursor) {
    cursorData = decodeCursor(cursor)
    if (!cursorData) {
      return errorResponse(400, 'INVALID_CURSOR', 'i18n:errors.invalid_cursor', rid)
    }
  }

  // ── Fetch wallet + user profile in parallel ────────────────────────────────
  const [walletResult, profileResult] = await Promise.all([
    supabase
      .from('wallets')
      .select('id, user_id, balance_points, updated_at')
      .eq('user_id', userId)
      .maybeSingle(),
    supabase
      .from('user_profiles')
      .select('display_name, phone_number, role')
      .eq('id', userId)
      .maybeSingle(),
  ])

  if (walletResult.error !== null) {
    console.error('[api/wallets/[userId]] wallet fetch failed', {
      rid,
      userId,
      message: walletResult.error.message,
    })
    return errorResponse(500, 'INTERNAL_ERROR', 'i18n:errors.internal_error', rid)
  }
  if (walletResult.data === null) {
    return errorResponse(404, 'NOT_FOUND', 'Wallet not found.', rid)
  }

  // ── Fetch transactions with cursor pagination ──────────────────────────────
  let txQuery = supabase
    .from('wallet_transactions')
    .select('id, delta, reason, scan_attempt_id, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit + 1)

  if (cursorData) {
    txQuery = txQuery.or(
      `created_at.lt.${cursorData.c},and(created_at.eq.${cursorData.c},id.lt.${cursorData.i})`,
    )
  }

  const { data: txData, error: txError } = await txQuery

  if (txError !== null) {
    console.error('[api/wallets/[userId]] transactions fetch failed', {
      rid,
      userId,
      message: txError.message,
    })
    return errorResponse(500, 'INTERNAL_ERROR', 'i18n:errors.internal_error', rid)
  }

  const hasMore = txData.length > limit
  const txItems = hasMore ? txData.slice(0, limit) : txData
  const lastTx = txItems.at(-1)
  const nextCursor = hasMore && lastTx ? encodeCursor(lastTx.created_at, lastTx.id) : null

  const wallet = walletResult.data
  const profile = profileResult.data

  return NextResponse.json({
    data: {
      id: wallet.id,
      user_id: wallet.user_id,
      balance_points: wallet.balance_points,
      display_name: profile?.display_name ?? null,
      phone_number: profile?.phone_number ?? null,
      role: profile?.role ?? null,
      updated_at: wallet.updated_at,
      transactions: txItems.map(t => ({
        id: t.id,
        delta: t.delta,
        reason: t.reason,
        scan_attempt_id: t.scan_attempt_id,
        created_at: t.created_at,
      })),
    },
    pagination: { next_cursor: nextCursor, has_more: hasMore },
    meta: { request_id: rid },
  })
}
