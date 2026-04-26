import { type NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { z } from 'zod'
import { createServerClient, createServiceClient } from '@gaia/supabase'
import { reqId, errorResponse } from '@/lib/api'

const patchSchema = z.object({
  farmer_points_per_return: z.number().int().min(0),
  dealer_points_per_return: z.number().int().min(0),
})

// ── GET — any authenticated role ───────────────────────────────────────────────
export async function GET(): Promise<NextResponse> {
  const rid = reqId()

  const cookieStore = cookies()
  const supabase = createServerClient(cookieStore)
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return errorResponse(401, 'AUTH_REQUIRED', 'i18n:errors.auth_required', rid)
  }

  const { data, error } = await supabase
    .from('reward_config')
    .select('farmer_points_per_return, dealer_points_per_return, updated_by, updated_at')
    .eq('id', 1)
    .single()

  if (error) {
    console.error('[api/reward-config] fetch failed', { rid, message: error.message })
    return errorResponse(500, 'INTERNAL_ERROR', 'i18n:errors.internal_error', rid)
  }

  return NextResponse.json({ data, meta: { request_id: rid } })
}

// ── PATCH — gabs_admin only ────────────────────────────────────────────────────
export async function PATCH(request: NextRequest): Promise<NextResponse> {
  const rid = reqId()

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

  // ── Parse body ─────────────────────────────────────────────────────────────
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return errorResponse(400, 'INVALID_JSON', 'Request body must be valid JSON.', rid)
  }

  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) {
    return errorResponse(
      400,
      'VALIDATION_FAILED',
      'i18n:errors.validation_failed',
      rid,
      parsed.error.issues.map(i => ({ field: String(i.path[0] ?? ''), issue: i.message })),
    )
  }

  const { farmer_points_per_return, dealer_points_per_return } = parsed.data

  // ── Capture before snapshot for audit ─────────────────────────────────────
  const { data: before, error: fetchError } = await supabase
    .from('reward_config')
    .select('farmer_points_per_return, dealer_points_per_return, updated_by, updated_at')
    .eq('id', 1)
    .single()

  if (fetchError) {
    console.error('[api/reward-config] pre-update fetch failed', { rid, message: fetchError.message })
    return errorResponse(500, 'INTERNAL_ERROR', 'i18n:errors.internal_error', rid)
  }

  // ── Update — gabs_admin RLS policy allows this ─────────────────────────────
  const { data: updated, error: updateError } = await supabase
    .from('reward_config')
    .update({
      farmer_points_per_return,
      dealer_points_per_return,
      updated_by: user.id,
    })
    .eq('id', 1)
    .select('farmer_points_per_return, dealer_points_per_return, updated_by, updated_at')
    .single()

  if (updateError) {
    console.error('[api/reward-config] update failed', { rid, message: updateError.message })
    return errorResponse(500, 'INTERNAL_ERROR', 'i18n:errors.internal_error', rid)
  }

  // ── Audit log — service_role (config_audit_log has no client INSERT policy) ─
  const serviceClient = createServiceClient()
  const { error: auditError } = await serviceClient.from('config_audit_log').insert({
    table_name: 'reward_config',
    changed_by: user.id,
    before: before as unknown as Record<string, unknown>,
    after: updated as unknown as Record<string, unknown>,
  })

  if (auditError) {
    // Update succeeded; log the audit failure without failing the request.
    console.error('[api/reward-config] audit log insert failed', { rid, message: auditError.message })
  }

  return NextResponse.json({ data: updated, meta: { request_id: rid } })
}
