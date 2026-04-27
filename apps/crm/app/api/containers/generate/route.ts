import { type NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createHmac } from 'node:crypto'
import { z } from 'zod'
import { createServerClient, createServiceClient } from '@gaia/supabase'
import { reqId, errorResponse } from '@/lib/api'
import { getHmacSecret, computeHmac16 } from '@/lib/scan/hmac'

const ALLOWED_ROLES = ['gabs_admin', 'brand_admin'] as const
const MAX_QUANTITY = 10_000

const bodySchema = z.object({
  product_id: z.string().uuid(),
  quantity: z.number().int().min(1).max(MAX_QUANTITY),
  assigned_dealer_id: z.string().uuid().optional(),
})

function computeFullHmac(uuid: string, secret: string): string {
  return createHmac('sha256', secret).update(uuid).digest('hex')
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const rid = reqId()
  const cookieStore = cookies()
  const supabase = createServerClient(cookieStore)

  // Auth.
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return errorResponse(401, 'AUTH_REQUIRED', 'i18n:errors.auth_required', rid)

  // Role check.
  const userRole = (user.app_metadata?.['user_role'] ?? '') as string
  if (!(ALLOWED_ROLES as readonly string[]).includes(userRole)) {
    return errorResponse(403, 'FORBIDDEN', 'i18n:errors.forbidden', rid)
  }

  // Idempotency key — required header.
  const idempotencyKey = request.headers.get('Idempotency-Key')
  if (!idempotencyKey || idempotencyKey.trim().length === 0) {
    return errorResponse(400, 'MISSING_IDEMPOTENCY_KEY', 'i18n:errors.missing_idempotency_key', rid)
  }

  // Parse body.
  let body: z.infer<typeof bodySchema>
  try {
    const raw: unknown = await request.json()
    body = bodySchema.parse(raw)
  } catch {
    return errorResponse(400, 'VALIDATION_FAILED', 'i18n:errors.validation_failed', rid)
  }

  const service = createServiceClient()

  // Idempotency check — return cached result if this key was already committed.
  const { data: existing } = await service
    .from('batch_generation_log')
    .select('batch_id, quantity')
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle()

  if (existing) {
    return NextResponse.json({
      data: {
        batch_id: existing.batch_id,
        container_count: existing.quantity,
        qr_prefix: 'gaia.ph/scan/',
      },
      meta: { request_id: rid, cached: true },
    })
  }

  // Verify product exists.
  const { data: product, error: productErr } = await service
    .from('products')
    .select('id')
    .eq('id', body.product_id)
    .single()

  if (productErr || !product) {
    return errorResponse(404, 'PRODUCT_NOT_FOUND', 'i18n:errors.product_not_found', rid)
  }

  let secret: string
  try {
    secret = getHmacSecret()
  } catch {
    console.error('[api/containers/generate] HMAC_SECRET not configured', { rid })
    return errorResponse(500, 'INTERNAL_ERROR', 'i18n:errors.internal_error', rid)
  }

  // Generate container rows. HMACs are computed in Node so the secret never
  // enters the DB layer. Never log individual HMAC values — log batch_id + count only.
  const batchId = crypto.randomUUID()
  const rows = Array.from({ length: body.quantity }, () => {
    const id = crypto.randomUUID()
    const hmacSuffix = computeHmac16(id, secret)
    const hmac = computeFullHmac(id, secret)
    return {
      id,
      product_id: body.product_id,
      hmac,
      hmac_suffix: hmacSuffix,
      // batch_number stores the batch UUID so export-labels can query by it.
      // The (product_id, batch_number) composite index covers this lookup.
      batch_number: batchId,
      dealer_id: body.assigned_dealer_id ?? null,
    }
  })

  // Batch insert — single statement, atomic by PostgREST.
  // Statement timeout for large batches is configured at the Supabase project
  // level (db.statement_timeout); 30 s is the minimum recommended for 10k rows.
  const { error: insertErr } = await service.from('containers').insert(rows)

  if (insertErr) {
    console.error('[api/containers/generate] batch insert failed', {
      rid,
      batch_id: batchId,
      quantity: body.quantity,
      message: insertErr.message,
    })
    return errorResponse(500, 'INTERNAL_ERROR', 'i18n:errors.internal_error', rid)
  }

  // Commit idempotency record — after containers are inserted so a crash here
  // leaves containers without a log entry (retry will detect missing key and
  // re-generate; containers from the failed run become unreachable orphans that
  // a periodic cleanup job can purge via batch_generation_log join).
  const { error: logErr } = await service.from('batch_generation_log').insert({
    idempotency_key: idempotencyKey,
    batch_id: batchId,
    product_id: body.product_id,
    quantity: body.quantity,
    created_by: user.id,
  })

  if (logErr) {
    console.error('[api/containers/generate] batch log insert failed', {
      rid,
      batch_id: batchId,
      message: logErr.message,
    })
    // Containers are inserted; do not fail the request — the client has usable
    // containers. Log the gap for ops to investigate.
  }

  console.info('[api/containers/generate] batch committed', {
    rid,
    batch_id: batchId,
    quantity: body.quantity,
  })

  return NextResponse.json(
    {
      data: {
        batch_id: batchId,
        container_count: body.quantity,
        qr_prefix: 'gaia.ph/scan/',
      },
      meta: { request_id: rid },
    },
    { status: 201 },
  )
}
