import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createServiceClient } from '@gaia/supabase'
import { reqId, errorResponse, encodeCursor, decodeCursor } from '@/lib/api'
import { getRequestUser } from '@/lib/auth/request'

const SCAN_STEPS = ['purchase_dealer', 'purchase_farmer', 'return_dealer', 'return_farmer'] as const

const querySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  step: z.enum(SCAN_STEPS).optional(),
})

interface ScanRow {
  id: string
  container_id: string | null
  step: string
  outcome: string
  sync_delayed: boolean
  created_at: string
  containers: { products: { product_name: string } | null } | null
}

// GET /api/scans/me — the authenticated user's scan history (api-spec §11.1).
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

  const { cursor, limit, step } = parsed.data

  let cursorData: { c: string; i: string } | null = null
  if (cursor) {
    cursorData = decodeCursor(cursor)
    if (!cursorData) {
      return errorResponse(400, 'INVALID_CURSOR', 'i18n:errors.invalid_cursor', rid)
    }
  }

  const service = createServiceClient()

  let query = service
    .from('scan_attempts')
    .select('id, container_id, step, outcome, sync_delayed, created_at, containers(products(product_name))')
    .eq('actor_id', user.id)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit + 1)

  if (step) {
    query = query.eq('step', step)
  }
  if (cursorData) {
    query = query.or(
      `created_at.lt.${cursorData.c},and(created_at.eq.${cursorData.c},id.lt.${cursorData.i})`,
    )
  }

  const { data, error } = await query

  if (error !== null) {
    console.error('[api/scans/me] fetch failed', { rid, message: error.message })
    return errorResponse(500, 'INTERNAL_ERROR', 'i18n:errors.internal_error', rid)
  }

  const rows = data as unknown as ScanRow[]
  const hasMore = rows.length > limit
  const items = hasMore ? rows.slice(0, limit) : rows
  const last = items.at(-1)
  const nextCursor = hasMore && last ? encodeCursor(last.created_at, last.id) : null

  return NextResponse.json({
    data: items.map(row => ({
      id: row.id,
      container_id: row.container_id,
      step: row.step,
      outcome: row.outcome,
      product_name: row.containers?.products?.product_name ?? null,
      sync_delayed: row.sync_delayed,
      created_at: row.created_at,
    })),
    pagination: { next_cursor: nextCursor, has_more: hasMore },
    meta: { request_id: rid },
  })
}
