import { type NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { z } from 'zod'
import { createServerClient, createServiceClient } from '@gaia/supabase'
import { reqId, errorResponse, encodeCursor, decodeCursor, sanitiseSearch } from '@/lib/api'

// ── Schemas ────────────────────────────────────────────────────────────────────

const listQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  is_verified: z.enum(['true', 'false']).transform(v => v === 'true').optional(),
  search: z.string().max(200).optional(),
})

const inviteBodySchema = z.object({
  email: z.string().email('Must be a valid email address').max(320),
  business_name: z.string().min(1, 'Business name is required').max(255),
  territory_notes: z.string().max(1000).optional(),
  phone_number: z
    .string()
    .refine(
      v => !v || /^\+[1-9]\d{6,14}$/.test(v),
      'Phone must be in E.164 format (e.g. +639171234567)',
    )
    .optional(),
})

const LIST_COLUMNS =
  'id, user_id, business_name, territory_notes, is_verified, verified_at, created_at'

// ── GET /api/dealers ───────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const rid = reqId()

  const cookieStore = cookies()
  const supabase = createServerClient(cookieStore)
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return errorResponse(401, 'AUTH_REQUIRED', 'i18n:errors.auth_required', rid)
  }

  const role = (user.app_metadata?.role as string) ?? ''
  if (role !== 'gabs_admin') {
    return errorResponse(403, 'FORBIDDEN', 'i18n:errors.forbidden', rid)
  }

  const raw = Object.fromEntries(request.nextUrl.searchParams)
  const parsed = listQuerySchema.safeParse(raw)
  if (!parsed.success) {
    return errorResponse(
      400,
      'VALIDATION_FAILED',
      'i18n:errors.validation_failed',
      rid,
      parsed.error.issues.map(i => ({ field: String(i.path[0] ?? ''), issue: i.message })),
    )
  }

  const { cursor, limit, is_verified, search } = parsed.data

  let cursorData: { c: string; i: string } | null = null
  if (cursor) {
    cursorData = decodeCursor(cursor)
    if (!cursorData) {
      return errorResponse(400, 'INVALID_CURSOR', 'i18n:errors.invalid_cursor', rid)
    }
  }

  // SERVICE_ROLE_WARNING: gabs_admin-only list; service client for uniform read access.
  const svc = createServiceClient()

  let query = svc
    .from('dealer_accounts')
    .select(LIST_COLUMNS)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit + 1)

  if (typeof is_verified === 'boolean') {
    query = query.eq('is_verified', is_verified)
  }

  if (search) {
    const safe = sanitiseSearch(search)
    if (safe.length > 0) {
      query = query.or(
        `business_name.ilike.%${safe}%,territory_notes.ilike.%${safe}%`,
      )
    }
  }

  if (cursorData) {
    query = query.or(
      `created_at.lt.${cursorData.c},and(created_at.eq.${cursorData.c},id.lt.${cursorData.i})`,
    )
  }

  const { data, error } = await query
  if (error) {
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

// ── POST /api/dealers (invite) ─────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const rid = reqId()

  const cookieStore = cookies()
  const supabase = createServerClient(cookieStore)
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return errorResponse(401, 'AUTH_REQUIRED', 'i18n:errors.auth_required', rid)
  }

  const role = (user.app_metadata?.role as string) ?? ''
  if (role !== 'gabs_admin') {
    return errorResponse(403, 'FORBIDDEN', 'i18n:errors.forbidden', rid)
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return errorResponse(400, 'VALIDATION_FAILED', 'i18n:errors.validation_failed', rid)
  }

  const parsed = inviteBodySchema.safeParse(body)
  if (!parsed.success) {
    return errorResponse(
      400,
      'VALIDATION_FAILED',
      'i18n:errors.validation_failed',
      rid,
      parsed.error.issues.map(i => ({ field: i.path.join('.'), issue: i.message })),
    )
  }

  const { email, business_name, territory_notes, phone_number } = parsed.data

  // SERVICE_ROLE_WARNING: Supabase auth admin API requires the service role key.
  const svc = createServiceClient()

  // Send a Supabase magic-link invite. The invite token is delivered via email only —
  // it is never returned by this API or surfaced in the UI.
  const { data: inviteData, error: inviteError } = await svc.auth.admin.inviteUserByEmail(email, {
    data: {
      role: 'dealer',
      ...(phone_number ? { phone_number } : {}),
    },
  })

  if (inviteError) {
    // Supabase returns 422 when the email is already registered.
    if (
      inviteError.status === 422 ||
      inviteError.message?.toLowerCase().includes('already registered') ||
      inviteError.message?.toLowerCase().includes('already been invited')
    ) {
      return errorResponse(409, 'CONFLICT', 'i18n:errors.conflict', rid)
    }
    return errorResponse(500, 'INTERNAL_ERROR', 'i18n:errors.internal_error', rid)
  }

  if (!inviteData?.user) {
    return errorResponse(500, 'INTERNAL_ERROR', 'i18n:errors.internal_error', rid)
  }

  // Pre-create the dealer_accounts row so the dealer appears in the list before first login.
  const { data: dealer, error: insertError } = await svc
    .from('dealer_accounts')
    .insert({
      user_id: inviteData.user.id,
      business_name,
      territory_notes: territory_notes ?? null,
      is_verified: false,
    })
    .select('id, business_name')
    .single()

  if (insertError || !dealer) {
    return errorResponse(500, 'INTERNAL_ERROR', 'i18n:errors.internal_error', rid)
  }

  return NextResponse.json(
    {
      data: {
        id: dealer.id,
        email,
        business_name: dealer.business_name,
        is_verified: false,
        invite_sent: true,
      },
      meta: { request_id: rid },
    },
    { status: 201 },
  )
}
