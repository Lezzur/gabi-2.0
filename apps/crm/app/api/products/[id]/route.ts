import { type NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { z } from 'zod'
import { createServerClient, createServiceClient, type Database } from '@gaia/supabase'
import { reqId, errorResponse } from '@/lib/api'

type ProductUpdate = Database['public']['Tables']['products']['Update']

// ── Zod schemas ───────────────────────────────────────────────────────────────

// Fields any admin (gabs_admin or brand_admin) may edit.
const sharedPatchSchema = z.object({
  brand_name: z.string().max(255).nullable().optional(),
  mode_of_entry: z.string().max(255).nullable().optional(),
  mode_of_action_group: z.string().max(255).nullable().optional(),
  dosage_rate: z.string().max(255).nullable().optional(),
  mrl: z.string().max(255).nullable().optional(),
  pre_harvest_interval: z.string().max(255).nullable().optional(),
  re_entry_period: z.string().max(255).nullable().optional(),
  timing_of_application: z.string().max(500).nullable().optional(),
  note_to_physician: z.string().max(2000).nullable().optional(),
  pests: z.string().max(1000).nullable().optional(),
  distributor: z.string().max(255).nullable().optional(),
  formulated_by: z.string().max(255).nullable().optional(),
  imported_by: z.string().max(255).nullable().optional(),
})

// Additional fields only gabs_admin may edit.
const gabsAdminPatchSchema = sharedPatchSchema.extend({
  product_name: z.string().min(1).max(500).optional(),
  company: z.string().min(1).max(255).optional(),
  active_ingredient: z.string().min(1).max(500).optional(),
  concentration: z.string().max(100).nullable().optional(),
  formulation_type: z
    .enum(['EC', 'SC', 'WP', 'WG', 'SL', 'GR', 'DP', 'ULV', 'OTHER'])
    .nullable()
    .optional(),
  type: z
    .enum(['HERBICIDE', 'INSECTICIDE', 'FUNGICIDE', 'RODENTICIDE', 'NEMATICIDE', 'ACARICIDE', 'OTHER'])
    .nullable()
    .optional(),
  category: z.enum(['1', '2', '3', '4']).nullable().optional(),
  fpa_registration_number: z.string().max(100).nullable().optional(),
  fpa_registration_expires_at: z.string().nullable().optional(),
  status: z.enum(['draft', 'active', 'suspended']).optional(),
  label_image_storage_path: z.string().max(1000).nullable().optional(),
  category_confirmed_by: z.string().uuid().nullable().optional(),
  category_confirmed_at: z.string().datetime({ offset: true }).nullable().optional(),
  note_to_physician_confirmed_by: z.string().uuid().nullable().optional(),
  note_to_physician_confirmed_at: z.string().datetime({ offset: true }).nullable().optional(),
})

type RouteContext = { params: { id: string } }

// ── GET /api/products/[id] ────────────────────────────────────────────────────

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

  // Use the user-scoped client so RLS enforces visibility per role.
  const { data: product, error } = await supabase
    .from('products')
    .select('*')
    .eq('id', id)
    .single()

  if (error?.code === 'PGRST116' || !product) {
    return errorResponse(404, 'NOT_FOUND', 'i18n:errors.not_found', rid)
  }
  if (error) {
    return errorResponse(500, 'INTERNAL_ERROR', 'i18n:errors.internal_error', rid)
  }

  const { data: crops } = await supabase
    .from('product_crops')
    .select('id, crop, pests')
    .eq('product_id', id)

  return NextResponse.json({
    data: { ...product, crops: crops ?? [] },
    meta: { request_id: rid },
  })
}

// ── PATCH /api/products/[id] ─────────────────────────────────────────────────

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const rid = reqId()
  const { id } = params

  // ── Auth ─────────────────────────────────────────────────────────────────
  const cookieStore = cookies()
  const supabase = createServerClient(cookieStore)
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return errorResponse(401, 'AUTH_REQUIRED', 'i18n:errors.auth_required', rid)
  }

  const role = (user.app_metadata?.['user_role'] ?? user.app_metadata?.['role'] ?? '') as string
  if (role !== 'gabs_admin' && role !== 'brand_admin') {
    return errorResponse(403, 'FORBIDDEN', 'i18n:errors.forbidden', rid)
  }

  // ── Body validation ──────────────────────────────────────────────────────
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return errorResponse(400, 'VALIDATION_FAILED', 'i18n:errors.validation_failed', rid)
  }

  const schema = role === 'gabs_admin' ? gabsAdminPatchSchema : sharedPatchSchema
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return errorResponse(
      400,
      'VALIDATION_FAILED',
      'i18n:errors.validation_failed',
      rid,
      parsed.error.issues.map(i => ({ field: i.path.join('.'), issue: i.message })),
    )
  }

  if (Object.keys(parsed.data).length === 0) {
    return errorResponse(400, 'VALIDATION_FAILED', 'i18n:errors.validation_failed', rid)
  }

  // ── Fetch existing product ───────────────────────────────────────────────
  // SERVICE_ROLE_WARNING: service client used here so admins can read/write
  // regardless of RLS visibility rules; all authorisation is checked manually above.
  const svc = createServiceClient()

  const { data: product, error: fetchError } = await svc
    .from('products')
    .select('id, company, status, category_confirmed_at, note_to_physician_confirmed_at')
    .eq('id', id)
    .single()

  if (fetchError?.code === 'PGRST116' || !product) {
    return errorResponse(404, 'NOT_FOUND', 'i18n:errors.not_found', rid)
  }
  if (fetchError) {
    return errorResponse(500, 'INTERNAL_ERROR', 'i18n:errors.internal_error', rid)
  }

  // ── brand_admin ownership check ──────────────────────────────────────────
  if (role === 'brand_admin') {
    const { data: mfr } = await svc
      .from('manufacturer_accounts')
      .select('company_name')
      .eq('user_id', user.id)
      .single()

    if (!mfr || mfr.company_name !== product.company) {
      return errorResponse(403, 'FORBIDDEN', 'i18n:errors.forbidden', rid)
    }
  }

  // ── 422: activating without confirmed safety fields ──────────────────────
  if (role === 'gabs_admin') {
    const p = parsed.data as z.infer<typeof gabsAdminPatchSchema>
    if (p.status === 'active') {
      const effectiveCategoryConfirmedAt =
        'category_confirmed_at' in p ? p.category_confirmed_at : product.category_confirmed_at
      const effectiveNtPConfirmedAt =
        'note_to_physician_confirmed_at' in p
          ? p.note_to_physician_confirmed_at
          : product.note_to_physician_confirmed_at

      if (!effectiveCategoryConfirmedAt || !effectiveNtPConfirmedAt) {
        return errorResponse(422, 'UNPROCESSABLE', 'i18n:errors.unprocessable', rid)
      }
    }
  }

  // ── Apply update ─────────────────────────────────────────────────────────
  const { data: updated, error: updateError } = await svc
    .from('products')
    .update(parsed.data as ProductUpdate)
    .eq('id', id)
    .select('*')
    .single()

  if (updateError || !updated) {
    return errorResponse(500, 'INTERNAL_ERROR', 'i18n:errors.internal_error', rid)
  }

  const { data: crops } = await svc
    .from('product_crops')
    .select('id, crop, pests')
    .eq('product_id', id)

  return NextResponse.json({
    data: { ...updated, crops: crops ?? [] },
    meta: { request_id: rid },
  })
}
