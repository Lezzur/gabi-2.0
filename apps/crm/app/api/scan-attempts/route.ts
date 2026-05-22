import { type NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { z } from 'zod'
import { createServerClient, createServiceClient } from '@gaia/supabase'
import { reqId, errorResponse, encodeCursor, decodeCursor } from '@/lib/api'

const SCAN_OUTCOMES = [
  'success',
  'hmac_invalid',
  'auth_required',
  'fpa_blocked',
  'already_claimed',
  'window_expired',
  'state_mismatch',
  'condition_rejected',
  'product_draft',
  'rate_limited',
] as const

const ACTOR_TYPES = ['farmer', 'dealer', 'admin'] as const

const querySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  outcome: z.enum(SCAN_OUTCOMES).optional(),
  actor_type: z.enum(ACTOR_TYPES).optional(),
  container_id: z.string().max(36).optional(),
  actor_id: z.string().uuid().optional(),
  sync_delayed: z
    .string()
    .transform((v, ctx) => {
      if (v === 'true') return true
      if (v === 'false') return false
      ctx.addIssue({ code: 'custom', message: 'Must be "true" or "false"' })
      return z.NEVER
    })
    .optional(),
  date_from: z.string().date().optional(),
  date_to: z.string().date().optional(),
})

const LIST_COLUMNS =
  'id, container_id, actor_id, actor_type, step, outcome, hmac_valid, auth_valid, ip_address, local_scan_ts, sync_ts, device_id, sync_delayed, created_at'

export async function GET(request: NextRequest) {
  const rid = reqId()

  // ── Auth ─────────────────────────────────────────────────────────────────────
  const cookieStore = cookies()
  const authClient = createServerClient(cookieStore)
  const {
    data: { user },
  } = await authClient.auth.getUser()

  if (!user) {
    return errorResponse(401, 'AUTH_REQUIRED', 'i18n:errors.auth_required', rid)
  }

  const role = (user.app_metadata?.['user_role'] ?? user.app_metadata?.['role'] ?? '') as string
  if (role !== 'gabs_admin') {
    return errorResponse(403, 'FORBIDDEN', 'i18n:errors.forbidden', rid)
  }

  const supabase = createServiceClient()

  // ── Query param validation ────────────────────────────────────────────────────
  const raw = Object.fromEntries(request.nextUrl.searchParams)
  const parsed = querySchema.safeParse(raw)
  if (!parsed.success) {
    return errorResponse(
      400,
      'VALIDATION_FAILED',
      'i18n:errors.validation_failed',
      rid,
      parsed.error.issues.map((i) => ({ field: String(i.path[0] ?? ''), issue: i.message })),
    )
  }

  const { cursor, limit, outcome, actor_type, container_id, actor_id, sync_delayed, date_from, date_to } =
    parsed.data

  // ── Cursor decode ─────────────────────────────────────────────────────────────
  let cursorData: { c: string; i: string } | null = null
  if (cursor) {
    cursorData = decodeCursor(cursor)
    if (!cursorData) {
      return errorResponse(400, 'INVALID_CURSOR', 'i18n:errors.invalid_cursor', rid)
    }
  }

  // ── Build query ───────────────────────────────────────────────────────────────
  let query = supabase
    .from('scan_attempts')
    .select(LIST_COLUMNS)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit + 1)

  if (outcome) query = query.eq('outcome', outcome)
  if (actor_type) query = query.eq('actor_type', actor_type)
  if (actor_id) query = query.eq('actor_id', actor_id)
  if (sync_delayed !== undefined) query = query.eq('sync_delayed', sync_delayed)
  if (date_from) query = query.gte('created_at', date_from)
  if (date_to) query = query.lte('created_at', `${date_to}T23:59:59.999Z`)
  // UUID prefix: cast to text for LIKE comparison
  if (container_id) query = query.filter('container_id::text', 'like', `${container_id}%`)

  if (cursorData) {
    query = query.or(
      `created_at.lt.${cursorData.c},and(created_at.eq.${cursorData.c},id.lt.${cursorData.i})`,
    )
  }

  // ── Execute ───────────────────────────────────────────────────────────────────
  const { data, error } = await query
  if (error) {
    console.error('[api/scan-attempts] list query failed', { request_id: rid, message: error.message })
    return errorResponse(500, 'INTERNAL_ERROR', 'i18n:errors.internal_error', rid)
  }

  const hasMore = data.length > limit
  const items = hasMore ? data.slice(0, limit) : data
  const last = items.at(-1)
  const nextCursor = hasMore && last ? encodeCursor(last.created_at, last.id) : null

  return NextResponse.json({
    data: items,
    pagination: { next_cursor: nextCursor, has_more: hasMore },
    meta: { request_id: rid },
  })
}
