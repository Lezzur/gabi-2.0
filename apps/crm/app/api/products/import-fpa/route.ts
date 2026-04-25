import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'

import { createServerClient, createServiceClient } from '@gaia/supabase'

import { parseFpaSpreadsheet } from '@/lib/products/fpa-parser'
import type { ParseErrorCode } from '@/lib/products/fpa-parser'

const MAX_FILE_BYTES = 5 * 1024 * 1024
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const ALLOWED_ROLES = new Set(['gabs_admin', 'brand_admin'])

const FATAL_PARSE_CODES = new Set<ParseErrorCode>([
  'SHEET_NOT_FOUND',
  'MISSING_HEADER',
  'ROW_LIMIT_EXCEEDED',
  'WORKBOOK_PARSE_ERROR',
])

const SKIP_CODES = new Set<ParseErrorCode>(['EMPTY_REGISTRATION', 'UNPARSEABLE_DATE'])

export const maxDuration = 180

export async function POST(request: NextRequest): Promise<NextResponse> {
  const t0 = Date.now()

  // — Auth —
  const cookieStore = cookies()
  const authClient = createServerClient(cookieStore)
  const {
    data: { user },
  } = await authClient.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const role = user.app_metadata?.['user_role'] as string | undefined
  if (!role || !ALLOWED_ROLES.has(role)) {
    return NextResponse.json(
      { error: { code: 'FORBIDDEN', message: 'Insufficient permissions' } },
      { status: 403 },
    )
  }

  // — Multipart extraction —
  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return NextResponse.json(
      { error: { code: 'INVALID_INPUT', message: 'Expected multipart/form-data' } },
      { status: 400 },
    )
  }

  const file = formData.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: { code: 'INVALID_INPUT', message: 'Missing file field' } },
      { status: 400 },
    )
  }

  // — File validation —
  const fileExt = file.name.split('.').pop()?.toLowerCase()
  if (fileExt !== 'xlsx') {
    return NextResponse.json(
      { error: { code: 'UNSUPPORTED_MEDIA_TYPE', message: 'Only .xlsx files are accepted' } },
      { status: 415 },
    )
  }
  // Reject if MIME is explicitly wrong; allow empty/octet-stream from generic clients
  if (file.type && file.type !== XLSX_MIME && file.type !== 'application/octet-stream') {
    return NextResponse.json(
      { error: { code: 'UNSUPPORTED_MEDIA_TYPE', message: 'Only .xlsx files are accepted' } },
      { status: 415 },
    )
  }
  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json(
      { error: { code: 'FILE_TOO_LARGE', message: 'File exceeds 5 MB limit' } },
      { status: 413 },
    )
  }

  // — Parse spreadsheet —
  const buffer = Buffer.from(await file.arrayBuffer())
  const { rows, errors: parseErrors } = await parseFpaSpreadsheet(buffer)

  const fatalErrors = parseErrors.filter(e => FATAL_PARSE_CODES.has(e.code))
  if (fatalErrors.length > 0) {
    return NextResponse.json(
      { error: { code: 'INVALID_INPUT', message: fatalErrors[0]!.message } },
      { status: 400 },
    )
  }

  const skippedCount = parseErrors.filter(e => SKIP_CODES.has(e.code)).length
  const rowErrors = parseErrors
    .filter(e => !FATAL_PARSE_CODES.has(e.code))
    .map(e => ({ row: e.row_index, reason: e.message }))

  if (rows.length === 0) {
    return NextResponse.json({
      data: { inserted: 0, updated: 0, skipped: skippedCount, errors: rowErrors },
      meta: { duration_ms: Date.now() - t0 },
    })
  }

  // — Deduplicate by registration number; aggregate crops —
  // The FPA spreadsheet has one row per crop per product registration. We group them into
  // a single products row and collect unique crops into product_crops rows.
  const productsByReg = new Map<string, (typeof rows)[0]>()
  const cropsByReg = new Map<string, Map<string, string | null>>() // reg → crop → pests

  for (const row of rows) {
    const reg = row.fpa_registration_number
    if (!productsByReg.has(reg)) {
      productsByReg.set(reg, row)
      cropsByReg.set(reg, new Map())
    }
    const cropMap = cropsByReg.get(reg)!
    for (const raw of row.registered_crops.split(',')) {
      const crop = raw.trim()
      if (crop && !cropMap.has(crop)) {
        cropMap.set(crop, row.pests ?? null)
      }
    }
  }

  const now = new Date().toISOString()

  // OCR-sourced fields are intentionally absent from the payload. PostgREST's ON CONFLICT
  // DO UPDATE only touches columns present in the INSERT list, so note_to_physician,
  // brand_name, distributor, formulated_by, imported_by, and mode_of_action_group are
  // preserved. status is also absent — FPA import does not gate product activation.
  const productPayload = Array.from(productsByReg.values()).map(row => ({
    product_name: row.product_name,
    company: row.company,
    active_ingredient: row.active_ingredient,
    concentration: row.concentration,
    formulation_type: row.formulation_type,
    type: row.type,
    category: row.category,
    fpa_registration_number: row.fpa_registration_number,
    fpa_registration_expires_at: row.fpa_registration_expires_at,
    fpa_last_imported_at: now,
    mode_of_entry: row.mode_of_entry,
    pests: row.pests,
    dosage_rate: row.dosage_rate,
    mrl: row.mrl,
    pre_harvest_interval: row.pre_harvest_interval,
    re_entry_period: row.re_entry_period,
  }))

  const serviceClient = createServiceClient()
  const allRegNums = productPayload.map(r => r.fpa_registration_number!)

  // Pre-flight read to split insert vs update counts in the response summary
  const { data: existing, error: existsError } = await serviceClient
    .from('products')
    .select('fpa_registration_number')
    .in('fpa_registration_number', allRegNums)

  if (existsError) {
    console.error('[fpa-import] existence check failed', { error: existsError.message })
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Database read failed' } },
      { status: 500 },
    )
  }

  const existingRegs = new Set(
    existing?.map(r => r.fpa_registration_number).filter(Boolean) ?? [],
  )
  const insertedCount = productPayload.filter(r => !existingRegs.has(r.fpa_registration_number)).length
  const updatedCount = productPayload.filter(r => existingRegs.has(r.fpa_registration_number)).length

  // — Upsert products —
  // A single .upsert() call maps to one PostgREST request, which Postgres wraps in a single
  // transaction. Any constraint violation rolls back the entire batch.
  const { data: upsertedProducts, error: upsertError } = await serviceClient
    .from('products')
    .upsert(productPayload, { onConflict: 'fpa_registration_number' })
    .select('id, fpa_registration_number')

  if (upsertError) {
    console.error('[fpa-import] products upsert failed', {
      error: upsertError.message,
      inserted: insertedCount,
      updated: updatedCount,
      duration_ms: Date.now() - t0,
    })
    return NextResponse.json(
      { error: { code: 'UPSERT_FAILED', message: 'Database write failed' } },
      { status: 500 },
    )
  }

  // — Upsert product_crops —
  const productIdByReg = new Map(
    (upsertedProducts ?? []).map(p => [p.fpa_registration_number, p.id]),
  )

  const cropPayload: Array<{ product_id: string; crop: string; pests: string | null }> = []
  for (const [reg, cropMap] of cropsByReg) {
    const productId = productIdByReg.get(reg)
    if (!productId) continue
    for (const [crop, pests] of cropMap) {
      cropPayload.push({ product_id: productId, crop, pests })
    }
  }

  if (cropPayload.length > 0) {
    const { error: cropsError } = await serviceClient
      .from('product_crops')
      .upsert(cropPayload, { onConflict: 'product_id,crop' })

    if (cropsError) {
      console.error('[fpa-import] crops upsert failed', {
        error: cropsError.message,
        crop_count: cropPayload.length,
        duration_ms: Date.now() - t0,
      })
      return NextResponse.json(
        { error: { code: 'CROPS_UPSERT_FAILED', message: 'Database write failed for crop data' } },
        { status: 500 },
      )
    }
  }

  const duration = Date.now() - t0
  console.log('[fpa-import] complete', {
    inserted: insertedCount,
    updated: updatedCount,
    skipped: skippedCount,
    row_errors: rowErrors.length,
    duration_ms: duration,
    user_id: user.id,
    role,
  })

  return NextResponse.json({
    data: {
      inserted: insertedCount,
      updated: updatedCount,
      skipped: skippedCount,
      errors: rowErrors,
    },
    meta: { duration_ms: duration },
  })
}
