import { type NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createServerClient, createServiceClient } from '@gaia/supabase'
import { reqId, errorResponse } from '@/lib/api'

type RouteContext = { params: { id: string } }

// ── GET /api/dealers/[id] ──────────────────────────────────────────────────────

export async function GET(_request: NextRequest, { params }: RouteContext) {
  const rid = reqId()
  const { id } = params

  const cookieStore = cookies()
  const supabase = createServerClient(cookieStore)
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return errorResponse(401, 'AUTH_REQUIRED', 'i18n:errors.auth_required', rid)
  }

  const role = (user.app_metadata?.role as string) ?? ''
  if (role !== 'gabs_admin' && role !== 'dealer') {
    return errorResponse(403, 'FORBIDDEN', 'i18n:errors.forbidden', rid)
  }

  // User-scoped client so RLS enforces dealer-can-see-own-row visibility.
  const { data: dealer, error } = await supabase
    .from('dealer_accounts')
    .select(
      'id, user_id, business_name, territory_notes, is_verified, verified_by, verified_at, created_at, updated_at',
    )
    .eq('id', id)
    .single()

  if (error?.code === 'PGRST116' || !dealer) {
    return errorResponse(404, 'NOT_FOUND', 'i18n:errors.not_found', rid)
  }
  if (error) {
    return errorResponse(500, 'INTERNAL_ERROR', 'i18n:errors.internal_error', rid)
  }

  // Defense-in-depth: dealer role may only read their own account regardless of RLS.
  if (role === 'dealer' && dealer.user_id !== user.id) {
    return errorResponse(403, 'FORBIDDEN', 'i18n:errors.forbidden', rid)
  }

  return NextResponse.json({ data: dealer, meta: { request_id: rid } })
}

// ── PATCH /api/dealers/[id] (verify) ──────────────────────────────────────────

export async function PATCH(_request: NextRequest, { params }: RouteContext) {
  const rid = reqId()
  const { id } = params

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

  // SERVICE_ROLE_WARNING: service client used for verify; auth checks performed above.
  const svc = createServiceClient()

  const { data: dealer, error: fetchError } = await svc
    .from('dealer_accounts')
    .select('id, is_verified')
    .eq('id', id)
    .single()

  if (fetchError?.code === 'PGRST116' || !dealer) {
    return errorResponse(404, 'NOT_FOUND', 'i18n:errors.not_found', rid)
  }
  if (fetchError) {
    return errorResponse(500, 'INTERNAL_ERROR', 'i18n:errors.internal_error', rid)
  }

  if (dealer.is_verified) {
    return errorResponse(409, 'CONFLICT', 'i18n:errors.conflict', rid)
  }

  const verifiedAt = new Date().toISOString()

  const { data: updated, error: updateError } = await svc
    .from('dealer_accounts')
    .update({ is_verified: true, verified_by: user.id, verified_at: verifiedAt })
    .eq('id', id)
    .select('id, is_verified, verified_by, verified_at')
    .single()

  if (updateError || !updated) {
    return errorResponse(500, 'INTERNAL_ERROR', 'i18n:errors.internal_error', rid)
  }

  // Structured server-side audit log. Migrate to an audit_logs table for a persistent trail.
  console.log(
    JSON.stringify({
      event: 'dealer.verified',
      dealer_id: updated.id,
      verified_by: updated.verified_by,
      verified_at: updated.verified_at,
      request_id: rid,
    }),
  )

  return NextResponse.json({
    data: {
      id: updated.id,
      is_verified: updated.is_verified,
      verified_by: updated.verified_by,
      verified_at: updated.verified_at,
    },
    meta: { request_id: rid },
  })
}
