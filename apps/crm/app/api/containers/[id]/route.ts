import { type NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { randomUUID } from 'node:crypto'
import { createServerClient } from '@gaia/supabase'
import type { ApiErrorResponse } from '@gaia/shared/types'

function errResponse(
  status: number,
  code: string,
  message: string,
  request_id: string,
): NextResponse<ApiErrorResponse> {
  return NextResponse.json({ error: { code, message, request_id } }, { status })
}

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const request_id = randomUUID()
  const supabase = createServerClient(cookies())

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError !== null || user === null) {
    return errResponse(401, 'UNAUTHORIZED', 'Authentication required.', request_id)
  }

  const { id } = params

  // Fetch container — RLS enforces visibility (admin sees all, dealer/farmer see own).
  const { data: container, error: cErr } = await supabase
    .from('containers')
    .select(
      'id, product_id, hmac, batch_number, manufacture_date, formulation_expires_at, state, purchased_by_user_id, dealer_id, return_dealer_id, purchased_at, returned_at, rewards_paid_at, created_at, updated_at',
    )
    .eq('id', id)
    .maybeSingle()

  if (cErr !== null) {
    console.error('[api/containers/[id]] fetch failed', { request_id, id, message: cErr.message })
    return errResponse(500, 'INTERNAL_ERROR', 'Failed to fetch container.', request_id)
  }
  if (container === null) {
    return errResponse(404, 'NOT_FOUND', 'Container not found.', request_id)
  }

  // Run product name and scan history fetches in parallel.
  const [productResult, scansResult, profileResult] = await Promise.all([
    supabase.from('products').select('product_name').eq('id', container.product_id).maybeSingle(),
    supabase
      .from('scan_attempts')
      .select('id, step, outcome, actor_type, sync_delayed, created_at')
      .eq('container_id', id)
      .order('created_at', { ascending: true }),
    supabase.from('user_profiles').select('role').eq('id', user.id).maybeSingle(),
  ])

  if (scansResult.error !== null) {
    console.error('[api/containers/[id]] scan history fetch failed', {
      request_id,
      id,
      message: scansResult.error.message,
    })
    return errResponse(500, 'INTERNAL_ERROR', 'Failed to fetch scan history.', request_id)
  }

  const isAdmin = profileResult.data?.role === 'gabs_admin'

  const responseData: Record<string, unknown> = {
    id: container.id,
    product_id: container.product_id,
    product_name: productResult.data?.product_name ?? null,
    batch_number: container.batch_number,
    manufacture_date: container.manufacture_date,
    formulation_expires_at: container.formulation_expires_at,
    state: container.state,
    purchased_by_user_id: container.purchased_by_user_id,
    dealer_id: container.dealer_id,
    return_dealer_id: container.return_dealer_id,
    purchased_at: container.purchased_at,
    returned_at: container.returned_at,
    rewards_paid_at: container.rewards_paid_at,
    scan_history: (scansResult.data ?? []).map((s) => ({
      id: s.id,
      step: s.step,
      outcome: s.outcome,
      actor_type: s.actor_type,
      sync_delayed: s.sync_delayed,
      created_at: s.created_at,
    })),
    created_at: container.created_at,
    updated_at: container.updated_at,
  }

  // hmac is only shown to admins; hmac_suffix is never exposed.
  if (isAdmin) {
    responseData['hmac'] = container.hmac
  }

  return NextResponse.json({ data: responseData, meta: { request_id } })
}
