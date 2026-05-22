import { type NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { z } from 'zod'
import { createServerClient, createServiceClient } from '@gaia/supabase'
import { reqId, errorResponse, encodeCursor, decodeCursor, sanitiseSearch } from '@/lib/api'

const querySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().max(200).optional(),
})

export async function GET(request: NextRequest) {
  const rid = reqId()

  // ── Auth ───────────────────────────────────────────────────────────────────
  const cookieStore = cookies()
  const authClient = createServerClient(cookieStore)
  const {
    data: { user },
  } = await authClient.auth.getUser()

  if (!user) {
    return errorResponse(401, 'AUTH_REQUIRED', 'i18n:errors.auth_required', rid)
  }

  const role = (user.app_metadata?.['user_role'] ?? user.app_metadata?.['role']) as string | undefined
  if (role !== 'gabs_admin') {
    return errorResponse(403, 'FORBIDDEN', 'i18n:errors.forbidden', rid)
  }

  const supabase = createServiceClient()

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

  const { cursor, limit, search } = parsed.data

  // ── Cursor decode ──────────────────────────────────────────────────────────
  let cursorData: { c: string; i: string } | null = null
  if (cursor) {
    cursorData = decodeCursor(cursor)
    if (!cursorData) {
      return errorResponse(400, 'INVALID_CURSOR', 'i18n:errors.invalid_cursor', rid)
    }
  }

  // ── Search: resolve matching user_ids from user_profiles ───────────────────
  // Wallets don't have a direct FK to user_profiles, so we pre-resolve IDs.
  let filteredUserIds: string[] | null = null
  if (search) {
    const safe = sanitiseSearch(search)
    if (safe.length > 0) {
      const { data: profiles } = await supabase
        .from('user_profiles')
        .select('id')
        .or(`display_name.ilike.%${safe}%,phone_number.ilike.%${safe}%`)
        .limit(500)
      filteredUserIds = (profiles ?? []).map(p => p.id)
    } else {
      filteredUserIds = []
    }
    if (filteredUserIds.length === 0) {
      return NextResponse.json({
        data: [],
        pagination: { next_cursor: null, has_more: false },
        meta: { request_id: rid },
      })
    }
  }

  // ── Build wallet query ─────────────────────────────────────────────────────
  let query = supabase
    .from('wallets')
    .select('id, user_id, balance_points, updated_at')
    .order('updated_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit + 1)

  if (filteredUserIds !== null) {
    query = query.in('user_id', filteredUserIds)
  }

  if (cursorData) {
    query = query.or(
      `updated_at.lt.${cursorData.c},and(updated_at.eq.${cursorData.c},id.lt.${cursorData.i})`,
    )
  }

  // ── Execute ────────────────────────────────────────────────────────────────
  const { data, error } = await query
  if (error) {
    console.error('[api/wallets] fetch failed', { rid, message: error.message })
    return errorResponse(500, 'INTERNAL_ERROR', 'i18n:errors.internal_error', rid)
  }

  const hasMore = data.length > limit
  const items = hasMore ? data.slice(0, limit) : data

  // ── Batch-fetch user profiles (avoids N+1) ─────────────────────────────────
  const userIds = items.map(w => w.user_id)
  const profileMap: Record<string, { display_name: string | null; phone_number: string | null; role: string }> = {}
  if (userIds.length > 0) {
    const { data: profiles } = await supabase
      .from('user_profiles')
      .select('id, display_name, phone_number, role')
      .in('id', userIds)
    for (const p of profiles ?? []) {
      profileMap[p.id] = { display_name: p.display_name, phone_number: p.phone_number, role: p.role }
    }
  }

  const last = items.at(-1)
  const nextCursor = hasMore && last ? encodeCursor(last.updated_at, last.id) : null

  return NextResponse.json({
    data: items.map(w => ({
      id: w.id,
      user_id: w.user_id,
      balance_points: w.balance_points,
      display_name: profileMap[w.user_id]?.display_name ?? null,
      phone_number: profileMap[w.user_id]?.phone_number ?? null,
      role: profileMap[w.user_id]?.role ?? null,
      last_activity: w.updated_at,
    })),
    pagination: { next_cursor: nextCursor, has_more: hasMore },
    meta: { request_id: rid },
  })
}
