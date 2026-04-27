// PRD §Phase 5 Safety Gate — human confirmation before a product is created.
// A product with status='draft' is inserted only after an authenticated
// brand_admin or gabs_admin has explicitly confirmed all three safety fields:
//   - confirmed_toxicity_category
//   - confirmed_note_to_physician
//   - confirmed_active_ingredient
// Products are never auto-promoted to 'active' from this endpoint.
// Promotion is a separate CRM admin action.

import { type NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { z } from 'zod'
import { createServerClient, createServiceClient } from '@gaia/supabase'
import { reqId, errorResponse } from '@/lib/api'

const ALLOWED_ROLES = ['gabs_admin', 'brand_admin'] as const

const confirmSchema = z.object({
  ocr_job_id: z.string().uuid(),

  // Product fields — required for safety checks.
  product_name: z.string().min(1).max(500),
  company: z.string().min(1).max(500),
  active_ingredient: z.string().min(1).max(500),
  toxicity_category: z.enum(['1', '2', '3', '4']).optional(),
  note_to_physician: z.string().max(2000).optional(),

  // Optional enrichment fields the user may have edited.
  brand_name: z.string().max(500).optional(),
  concentration: z.string().max(200).optional(),
  formulation_type: z
    .enum(['EC', 'SC', 'WP', 'WG', 'SL', 'GR', 'DP', 'ULV', 'OTHER'])
    .optional(),
  type: z
    .enum(['HERBICIDE', 'INSECTICIDE', 'FUNGICIDE', 'RODENTICIDE', 'NEMATICIDE', 'ACARICIDE', 'OTHER'])
    .optional(),
  fpa_registration_number: z.string().max(100).optional(),
  distributor: z.string().max(500).optional(),
  pests: z.string().max(2000).optional(),

  // Safety confirmation flags — all three MUST be true.
  confirmed_toxicity_category: z.boolean(),
  confirmed_note_to_physician: z.boolean(),
  confirmed_active_ingredient: z.boolean(),
})

type ConfirmInput = z.infer<typeof confirmSchema>

function findUnconfirmed(body: ConfirmInput): string | null {
  if (!body.confirmed_toxicity_category) return 'confirmed_toxicity_category'
  if (!body.confirmed_note_to_physician) return 'confirmed_note_to_physician'
  if (!body.confirmed_active_ingredient) return 'confirmed_active_ingredient'
  return null
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const rid = reqId()
  const cookieStore = cookies()
  const supabase = createServerClient(cookieStore)

  // Auth check.
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return errorResponse(401, 'AUTH_REQUIRED', 'i18n:errors.auth_required', rid)

  // Role check — only brand_admin and gabs_admin may confirm OCR results.
  const userRole = (user.app_metadata?.['user_role'] ?? '') as string
  if (!(ALLOWED_ROLES as readonly string[]).includes(userRole)) {
    return errorResponse(403, 'FORBIDDEN', 'i18n:errors.forbidden', rid)
  }

  // Parse body.
  let body: ConfirmInput
  try {
    const raw: unknown = await request.json()
    body = confirmSchema.parse(raw)
  } catch {
    return errorResponse(400, 'VALIDATION_FAILED', 'i18n:errors.validation_failed', rid)
  }

  // Safety gate 1: all three confirmation flags must be true.
  const unconfirmed = findUnconfirmed(body)
  if (unconfirmed !== null) {
    return errorResponse(
      400,
      'SAFETY_CONFIRMATION_REQUIRED',
      'i18n:errors.safety_confirmation_required',
      rid,
      { field: unconfirmed },
    )
  }

  // Safety gate 2: toxicity category I or II requires a non-empty note_to_physician.
  if (
    (body.toxicity_category === '1' || body.toxicity_category === '2') &&
    (!body.note_to_physician || body.note_to_physician.trim().length === 0)
  ) {
    return errorResponse(
      400,
      'SAFETY_MISSING_NOTE',
      'i18n:errors.safety_missing_note',
      rid,
      { field: 'note_to_physician' },
    )
  }

  const service = createServiceClient()

  // Verify the OCR job exists, belongs to this user, and is completed.
  const { data: job, error: jobErr } = await service
    .from('ocr_jobs')
    .select('id, status, user_id')
    .eq('id', body.ocr_job_id)
    .single()

  if (jobErr || !job) {
    return errorResponse(404, 'OCR_JOB_NOT_FOUND', 'i18n:errors.ocr_job_not_found', rid)
  }
  if (job.user_id !== user.id) {
    return errorResponse(403, 'FORBIDDEN', 'i18n:errors.forbidden', rid)
  }
  if (job.status !== 'completed') {
    return errorResponse(
      409,
      'OCR_JOB_NOT_READY',
      'i18n:errors.ocr_job_not_ready',
      rid,
      { status: job.status },
    )
  }

  // Insert product with status='draft'. Never auto-promote to active.
  const { data: product, error: insertErr } = await service
    .from('products')
    .insert({
      product_name: body.product_name,
      company: body.company,
      active_ingredient: body.active_ingredient,
      brand_name: body.brand_name ?? null,
      concentration: body.concentration ?? null,
      formulation_type: body.formulation_type ?? null,
      type: body.type ?? null,
      category: body.toxicity_category ?? null,
      note_to_physician: body.note_to_physician ?? null,
      fpa_registration_number: body.fpa_registration_number ?? null,
      distributor: body.distributor ?? null,
      pests: body.pests ?? null,
      status: 'draft',
      creator_id: user.id,
      ocr_job_id: body.ocr_job_id,
    })
    .select('id')
    .single()

  if (insertErr || !product) {
    console.error('[api/products/ocr/confirm] product insert failed', {
      rid,
      message: insertErr?.message,
    })
    return errorResponse(500, 'INTERNAL_ERROR', 'i18n:errors.internal_error', rid)
  }

  // Audit log — record confirmation with timestamp, user, product, and OCR job.
  const { error: auditErr } = await service.from('product_audit_log').insert({
    product_id: product.id,
    user_id: user.id,
    action: 'ocr_confirm',
    ocr_job_id: body.ocr_job_id,
  })

  if (auditErr) {
    // Product was created; log the audit failure without failing the request.
    console.error('[api/products/ocr/confirm] audit log insert failed', {
      rid,
      product_id: product.id,
      message: auditErr.message,
    })
  }

  return NextResponse.json(
    { data: { product_id: product.id }, meta: { request_id: rid } },
    { status: 201 },
  )
}
