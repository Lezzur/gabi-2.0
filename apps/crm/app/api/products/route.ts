import { type NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { z } from 'zod'
import { createServerClient } from '@gaia/supabase'
import { reqId, errorResponse, encodeCursor, decodeCursor, sanitiseSearch } from '@/lib/api'

const querySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(['draft', 'active', 'suspended']).optional(),
  category: z.enum(['1', '2', '3', '4']).optional(),
  formulation_type: z.enum(['EC', 'SC', 'WP', 'WG', 'SL', 'GR', 'DP', 'ULV', 'OTHER']).optional(),
  search: z.string().max(200).optional(),
})

// List of columns returned for the collection endpoint (subset of full row).
const LIST_COLUMNS =
  'id, product_name, company, active_ingredient, concentration, formulation_type, type, category, fpa_registration_number, fpa_registration_expires_at, status, updated_at'

export async function GET(request: NextRequest) {
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

  const { cursor, limit, status, category, formulation_type, search } = parsed.data

  // ── Cursor decode ──────────────────────────────────────────────────────────
  let cursorData: { c: string; i: string } | null = null
  if (cursor) {
    cursorData = decodeCursor(cursor)
    if (!cursorData) {
      return errorResponse(400, 'INVALID_CURSOR', 'i18n:errors.invalid_cursor', rid)
    }
  }

  // ── Build query ────────────────────────────────────────────────────────────
  // RLS on the products table already enforces visibility per role:
  //   gabs_admin / brand_admin → all statuses
  //   dealer / farmer → status = 'active' only
  // No need to double-filter here.
  let query = supabase
    .from('products')
    .select(LIST_COLUMNS)
    .order('updated_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit + 1) // fetch one extra to detect has_more

  if (status) query = query.eq('status', status)
  if (category) query = query.eq('category', category)
  if (formulation_type) query = query.eq('formulation_type', formulation_type)

  if (search) {
    const safe = sanitiseSearch(search)
    if (safe.length > 0) {
      // ILIKE across product_name, company, active_ingredient.
      // Each .or() call produces a separate AND-grouped OR block in PostgREST.
      query = query.or(
        `product_name.ilike.%${safe}%,company.ilike.%${safe}%,active_ingredient.ilike.%${safe}%`,
      )
    }
  }

  if (cursorData) {
    // Keyset pagination: (updated_at, id) < (c, i) for DESC sort.
    query = query.or(
      `updated_at.lt.${cursorData.c},and(updated_at.eq.${cursorData.c},id.lt.${cursorData.i})`,
    )
  }

  // ── Execute ────────────────────────────────────────────────────────────────
  const { data, error } = await query
  if (error) {
    return errorResponse(500, 'INTERNAL_ERROR', 'i18n:errors.internal_error', rid)
  }

  const hasMore = data.length > limit
  const items = hasMore ? data.slice(0, limit) : data
  const last = items.at(-1)
  const nextCursor = hasMore && last ? encodeCursor(last.updated_at, last.id) : null

  return NextResponse.json({
    data: items,
    pagination: { next_cursor: nextCursor, has_more: hasMore },
    meta: { request_id: rid },
  })
}
