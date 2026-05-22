import { type NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { createServerClient, createServiceClient } from '@gaia/supabase'
import type { ApiErrorResponse } from '@gaia/shared/types'
import { checkRateLimit } from '@/lib/rate-limit'

const CONTAINER_STATES = [
  'in_distribution',
  'pending_purchase',
  'purchased',
  'returned',
  'rewards_paid',
] as const

const querySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  product_id: z.string().uuid().optional(),
  state: z.enum(CONTAINER_STATES, { message: 'Invalid state value.' }).optional(),
  batch_number: z.string().optional(),
  dealer_id: z.string().uuid().optional(),
})

type Cursor = { c: string; i: string }

function decodeCursor(raw: string): Cursor | null {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString('utf-8'))
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      typeof (parsed as Record<string, unknown>)['c'] !== 'string' ||
      typeof (parsed as Record<string, unknown>)['i'] !== 'string'
    ) {
      return null
    }
    return parsed as Cursor
  } catch {
    return null
  }
}

function encodeCursor(created_at: string, id: string): string {
  return Buffer.from(JSON.stringify({ c: created_at, i: id })).toString('base64url')
}

function errResponse(
  status: number,
  code: string,
  message: string,
  request_id: string,
  field?: string,
): NextResponse<ApiErrorResponse> {
  return NextResponse.json(
    { error: { code, message, ...(field !== undefined ? { field } : {}), request_id } },
    { status },
  )
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const request_id = randomUUID()
  const authClient = createServerClient(cookies())

  const {
    data: { user },
    error: authError,
  } = await authClient.auth.getUser()
  if (authError !== null || user === null) {
    return errResponse(401, 'UNAUTHORIZED', 'Authentication required.', request_id)
  }

  if (!checkRateLimit(`containers:${user.id}`, 30, 60_000)) {
    return errResponse(429, 'RATE_LIMITED', 'Too many requests. Retry after 1 minute.', request_id)
  }

  const supabase = createServiceClient()

  const rawParams = Object.fromEntries(request.nextUrl.searchParams)
  const parsed = querySchema.safeParse(rawParams)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    return errResponse(
      400,
      'VALIDATION_ERROR',
      first?.message ?? 'Invalid query parameters.',
      request_id,
      first?.path[0]?.toString(),
    )
  }

  const { cursor, limit, product_id, state, batch_number, dealer_id } = parsed.data

  let decodedCursor: Cursor | null = null
  if (cursor !== undefined) {
    decodedCursor = decodeCursor(cursor)
    if (decodedCursor === null) {
      return errResponse(400, 'VALIDATION_ERROR', 'Invalid cursor.', request_id, 'cursor')
    }
  }

  // RLS enforces per-role row visibility; we never filter by user here.
  let query = supabase
    .from('containers')
    .select('id, product_id, batch_number, state, manufacture_date, formulation_expires_at, created_at')
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit + 1)

  if (product_id !== undefined) query = query.eq('product_id', product_id)
  if (state !== undefined) query = query.eq('state', state)
  if (batch_number !== undefined) query = query.eq('batch_number', batch_number)
  if (dealer_id !== undefined) query = query.eq('dealer_id', dealer_id)
  if (decodedCursor !== null) {
    query = query.or(
      `created_at.lt.${decodedCursor.c},and(created_at.eq.${decodedCursor.c},id.lt.${decodedCursor.i})`,
    )
  }

  const { data: rows, error: qErr } = await query
  if (qErr !== null) {
    console.error('[api/containers] list query failed', { request_id, message: qErr.message })
    return errResponse(500, 'INTERNAL_ERROR', 'Failed to fetch containers.', request_id)
  }

  const allRows = rows ?? []
  const has_more = allRows.length > limit
  const items = allRows.slice(0, limit)

  // Resolve product names in a single query rather than N+1.
  const productIds = [...new Set(items.map((r) => r.product_id))]
  const productNameMap = new Map<string, string>()
  if (productIds.length > 0) {
    const { data: products } = await supabase
      .from('products')
      .select('id, product_name')
      .in('id', productIds)
    for (const p of products ?? []) {
      productNameMap.set(p.id, p.product_name)
    }
  }

  const last = items[items.length - 1]
  const next_cursor =
    has_more && last !== undefined ? encodeCursor(last.created_at, last.id) : null

  const data = items.map((row) => ({
    id: row.id,
    product_id: row.product_id,
    product_name: productNameMap.get(row.product_id) ?? null,
    batch_number: row.batch_number,
    state: row.state,
    manufacture_date: row.manufacture_date,
    formulation_expires_at: row.formulation_expires_at,
    created_at: row.created_at,
  }))

  return NextResponse.json({
    data,
    pagination: { next_cursor, has_more },
    meta: { request_id },
  })
}
