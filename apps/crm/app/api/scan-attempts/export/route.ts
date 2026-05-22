import { type NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { z } from 'zod'
import { createServerClient, createServiceClient } from '@gaia/supabase'
import { reqId, errorResponse } from '@/lib/api'

const SCAN_OUTCOMES = [
  'success',
  'hmac_invalid',
  'auth_required',
  'fpa_blocked',
  'already_claimed',
  'window_expired',
  'state_mismatch',
  'condition_rejected',
  'product_draft',
  'rate_limited',
] as const

const ACTOR_TYPES = ['farmer', 'dealer', 'admin'] as const

const filterSchema = z.object({
  outcome: z.enum(SCAN_OUTCOMES).optional(),
  actor_type: z.enum(ACTOR_TYPES).optional(),
  container_id: z.string().max(36).optional(),
  actor_id: z.string().uuid().optional(),
  sync_delayed: z
    .string()
    .transform((v, ctx) => {
      if (v === 'true') return true
      if (v === 'false') return false
      ctx.addIssue({ code: 'custom', message: 'Must be "true" or "false"' })
      return z.NEVER
    })
    .optional(),
  date_from: z.string().date().optional(),
  date_to: z.string().date().optional(),
})

type Filters = z.infer<typeof filterSchema>

const EXPORT_COLUMNS =
  'id, container_id, actor_id, actor_type, step, outcome, ip_address, local_scan_ts, sync_delayed, created_at'

const CSV_HEADER =
  'timestamp,container_uuid,product_name,fpa_registration_number,actor_type,outcome,step,sync_delayed,ip_address\r\n'

const BATCH_SIZE = 500

/**
 * Prevents CSV injection by prefixing values that start with formula-trigger chars.
 * RFC 4180 quoting: wraps in double quotes when field contains comma, quote, or newline.
 */
function csvField(value: string | boolean | null | undefined): string {
  const str = String(value ?? '')
  const safe = /^[=+\-@]/.test(str) ? `'${str}` : str
  if (/[,"\r\n]/.test(safe)) {
    return `"${safe.replace(/"/g, '""')}"`
  }
  return safe
}

function buildCsvRow(fields: (string | boolean | null | undefined)[]): string {
  return fields.map(csvField).join(',') + '\r\n'
}

function buildFilename(filters: Filters): string {
  const from = filters.date_from ?? 'all'
  const to = filters.date_to ?? new Date().toISOString().slice(0, 10)
  return `scan-attempts-${from}-to-${to}.csv`
}

export async function GET(request: NextRequest) {
  const rid = reqId()

  // ── Auth (gabs_admin only) ────────────────────────────────────────────────────
  const cookieStore = cookies()
  const supabase = createServerClient(cookieStore)
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return errorResponse(401, 'AUTH_REQUIRED', 'i18n:errors.auth_required', rid)
  }

  const role = (user.app_metadata?.['user_role'] ?? user.app_metadata?.['role'] ?? '') as string
  if (role !== 'gabs_admin') {
    return errorResponse(403, 'FORBIDDEN', 'i18n:errors.forbidden', rid)
  }

  // ── Filter validation ─────────────────────────────────────────────────────────
  const raw = Object.fromEntries(request.nextUrl.searchParams)
  const parsed = filterSchema.safeParse(raw)
  if (!parsed.success) {
    return errorResponse(
      400,
      'VALIDATION_FAILED',
      'i18n:errors.validation_failed',
      rid,
      parsed.error.issues.map((i) => ({ field: String(i.path[0] ?? ''), issue: i.message })),
    )
  }

  const filters = parsed.data

  // ── Audit log ─────────────────────────────────────────────────────────────────
  console.log('[scan-attempts/export] CSV export initiated', {
    user_id: user.id,
    email: user.email,
    filters,
    request_id: rid,
    timestamp: new Date().toISOString(),
  })

  // Service client bypasses RLS; auth already verified above.
  const svc = createServiceClient()
  const encoder = new TextEncoder()
  const filename = buildFilename(filters)

  const stream = new ReadableStream({
    async start(controller) {
      let rowCount = 0

      try {
        controller.enqueue(encoder.encode(CSV_HEADER))

        let lastCreatedAt: string | null = null
        let lastId: string | null = null

        while (true) {
          // ── Fetch batch ───────────────────────────────────────────────────────
          let q = svc
            .from('scan_attempts')
            .select(EXPORT_COLUMNS)
            .order('created_at', { ascending: false })
            .order('id', { ascending: false })
            .limit(BATCH_SIZE)

          if (filters.outcome) q = q.eq('outcome', filters.outcome)
          if (filters.actor_type) q = q.eq('actor_type', filters.actor_type)
          if (filters.actor_id) q = q.eq('actor_id', filters.actor_id)
          if (filters.sync_delayed !== undefined) q = q.eq('sync_delayed', filters.sync_delayed)
          if (filters.date_from) q = q.gte('created_at', filters.date_from)
          if (filters.date_to) q = q.lte('created_at', `${filters.date_to}T23:59:59.999Z`)
          if (filters.container_id) q = q.filter('container_id::text', 'like', `${filters.container_id}%`)

          if (lastCreatedAt !== null && lastId !== null) {
            q = q.or(
              `created_at.lt.${lastCreatedAt},and(created_at.eq.${lastCreatedAt},id.lt.${lastId})`,
            )
          }

          const { data: rows, error: qErr } = await q
          if (qErr) {
            console.error('[scan-attempts/export] batch query error', {
              request_id: rid,
              message: qErr.message,
            })
            controller.error(new Error('Query failed'))
            return
          }

          if (!rows || rows.length === 0) break

          // ── Resolve container → product info ──────────────────────────────────
          const containerIds = [
            ...new Set(rows.map((r) => r.container_id).filter((id): id is string => id != null)),
          ]

          const productInfoMap = new Map<string, { product_name: string; fpa: string }>()

          if (containerIds.length > 0) {
            const { data: containers } = await svc
              .from('containers')
              .select('id, product_id')
              .in('id', containerIds)

            const productIds = [
              ...new Set((containers ?? []).map((c) => c.product_id).filter(Boolean)),
            ]

            if (productIds.length > 0) {
              const { data: products } = await svc
                .from('products')
                .select('id, product_name, fpa_registration_number')
                .in('id', productIds)

              const productMap = new Map(
                (products ?? []).map((p) => [
                  p.id,
                  { product_name: p.product_name, fpa: p.fpa_registration_number ?? '' },
                ]),
              )

              for (const c of containers ?? []) {
                const prod = productMap.get(c.product_id)
                if (prod) productInfoMap.set(c.id, prod)
              }
            }
          }

          // ── Write rows ────────────────────────────────────────────────────────
          for (const row of rows) {
            const info = row.container_id ? productInfoMap.get(row.container_id) : undefined
            controller.enqueue(
              encoder.encode(
                buildCsvRow([
                  row.created_at,           // timestamp (UTC ISO 8601)
                  row.container_id ?? '',
                  info?.product_name ?? '',
                  info?.fpa ?? '',
                  row.actor_type,
                  row.outcome,
                  row.step,
                  row.sync_delayed,
                  row.ip_address ?? '',
                ]),
              ),
            )
            rowCount++
          }

          if (rows.length < BATCH_SIZE) break

          const last = rows[rows.length - 1]
          if (!last) break
          lastCreatedAt = last.created_at
          lastId = last.id
        }

        console.log('[scan-attempts/export] CSV export completed', {
          user_id: user.id,
          request_id: rid,
          row_count: rowCount,
          timestamp: new Date().toISOString(),
        })

        controller.close()
      } catch (err) {
        console.error('[scan-attempts/export] stream error', { request_id: rid, error: err })
        controller.error(err)
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
      'X-Request-Id': rid,
    },
  })
}
