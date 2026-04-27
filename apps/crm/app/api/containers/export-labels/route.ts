import { type NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { z } from 'zod'
import { createServerClient } from '@gaia/supabase'
import { reqId, errorResponse } from '@/lib/api'

const ALLOWED_ROLES = ['gabs_admin', 'brand_admin'] as const

const bodySchema = z.object({
  container_ids: z.array(z.string().uuid()).min(1).max(10_000),
  format: z.enum(['pdf', 'zpl']),
})

// ─── ZPL generation ───────────────────────────────────────────────────────────
// Generates one 4×6-inch ZPL label per container (203 dpi = 812×609 dots).
// The QR code uses ZPL's native ^BQN command; no external library required.

function buildZplLabel(container: {
  id: string
  batch_number: string | null
  manufacture_date: string | null
  formulation_expires_at: string | null
  product_name: string | null
  fpa_registration_number: string | null
  company: string | null
}): string {
  const scanUrl = `https://gaia.ph/scan/${container.id}`
  const productLine = (container.product_name ?? 'Unknown Product').slice(0, 40)
  const companyLine = (container.company ?? '').slice(0, 40)
  const fpaLine = container.fpa_registration_number ?? '—'
  const batchLine = container.batch_number ?? '—'
  const mfgLine = container.manufacture_date ?? '—'
  const expLine = container.formulation_expires_at ?? '—'

  return [
    '^XA',
    '^CI28',                                    // UTF-8
    '^PW812^LL609',                             // 4×6 in at 203 dpi
    '^FO40,30^A0N,28,28^FB732,1,0,L^FD' + productLine + '^FS',
    '^FO40,65^A0N,22,22^FB500,1,0,L^FD' + companyLine + '^FS',
    '^FO40,95^A0N,18,18^FDFPA: ' + fpaLine + '^FS',
    '^FO40,120^A0N,18,18^FDBatch: ' + batchLine + '^FS',
    '^FO40,145^A0N,18,18^FDMfg: ' + mfgLine + '^FS',
    '^FO40,170^A0N,18,18^FDExp: ' + expLine + '^FS',
    // QR code (300×300 px at 203 dpi ≈ 60 modules)
    '^FO460,20',
    '^BQN,2,6',
    '^FDQA,' + scanUrl + '^FS',
    '^XZ',
  ].join('\n')
}

// ─── Minimal PDF generation ───────────────────────────────────────────────────
// Produces a valid PDF 1.4 with one text-only page per container.
// All text is sanitised to Latin-1 so byte offsets equal character counts
// (required for correct xref tables).
// QR code images require an additional library (e.g. pdfkit + qrcode).

function toAscii(s: string): string {
  // Replace characters outside printable ASCII with '?'
  return s.replace(/[^\x20-\x7E]/g, '?')
}

function pdfEscape(s: string): string {
  return toAscii(s).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
}

function buildPdfBytes(containers: Array<{
  id: string
  batch_number: string | null
  manufacture_date: string | null
  formulation_expires_at: string | null
  product_name: string | null
  fpa_registration_number: string | null
  company: string | null
}>): Uint8Array {
  // Build all object strings first, then lay them out with tracked byte offsets.
  const objStrings: string[] = []
  const pageRefs: string[] = []

  // Objects 1–4 are filled in after we know how many pages there are.
  // Reserve slots; we'll overwrite them.
  objStrings.push('') // 1 – catalog (placeholder)
  objStrings.push('') // 2 – pages   (placeholder)
  objStrings.push('3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj') // 3
  objStrings.push('4 0 obj\n<< /Producer (Gaia CRM) >>\nendobj') // 4

  for (const c of containers) {
    const scanUrl = `https://gaia.ph/scan/${c.id}`
    const lines = [
      c.product_name ?? 'Unknown Product',
      c.company ?? '',
      `FPA: ${c.fpa_registration_number ?? '-'}`,
      `Batch: ${c.batch_number ?? '-'}`,
      `Mfg: ${c.manufacture_date ?? '-'}`,
      `Exp: ${c.formulation_expires_at ?? '-'}`,
      `Scan: ${scanUrl}`,
    ]

    let y = 700
    const ops = lines.map((l) => {
      const op = `BT /F1 10 Tf 40 ${y} Td (${pdfEscape(l)}) Tj ET`
      y -= 18
      return op
    })
    const stream = ops.join('\n')
    const streamLen = stream.length // all ASCII after pdfEscape

    const streamObjNum = objStrings.length + 1
    objStrings.push(
      `${streamObjNum} 0 obj\n<< /Length ${streamLen} >>\nstream\n${stream}\nendstream\nendobj`,
    )

    const pageObjNum = objStrings.length + 1
    objStrings.push(
      `${pageObjNum} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 288 432]` +
        ` /Contents ${streamObjNum} 0 R /Resources << /Font << /F1 3 0 R >> >> >>\nendobj`,
    )
    pageRefs.push(`${pageObjNum} 0 R`)
  }

  // Fill in placeholders now that we know page refs
  objStrings[0] = '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj'
  objStrings[1] = `2 0 obj\n<< /Type /Pages /Kids [${pageRefs.join(' ')}] /Count ${pageRefs.length} >>\nendobj`

  const header = '%PDF-1.4\n'
  // Track byte offsets as we concatenate objects (all ASCII so byteLen == charLen)
  let cursor = header.length
  const offsets: number[] = []
  const bodyParts: string[] = []

  for (const obj of objStrings) {
    offsets.push(cursor)
    const part = obj + '\n'
    bodyParts.push(part)
    cursor += part.length
  }

  const xrefOffset = cursor
  const xrefEntries = ['0000000000 65535 f \n']
  for (const off of offsets) {
    xrefEntries.push(String(off).padStart(10, '0') + ' 00000 n \n')
  }
  const xref =
    `xref\n0 ${offsets.length + 1}\n` +
    xrefEntries.join('') +
    `trailer\n<< /Size ${offsets.length + 1} /Root 1 0 R /Info 4 0 R >>\n` +
    `startxref\n${xrefOffset}\n%%EOF\n`

  const full = header + bodyParts.join('') + xref
  return new TextEncoder().encode(full)
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(request: NextRequest): Promise<NextResponse> {
  const rid = reqId()
  const supabase = createServerClient(cookies())

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return errorResponse(401, 'AUTH_REQUIRED', 'i18n:errors.auth_required', rid)

  const userRole = ((user.app_metadata?.['user_role'] ?? user.app_metadata?.['role']) ?? '') as string
  if (!(ALLOWED_ROLES as readonly string[]).includes(userRole)) {
    return errorResponse(403, 'FORBIDDEN', 'i18n:errors.forbidden', rid)
  }

  let body: z.infer<typeof bodySchema>
  try {
    const raw: unknown = await request.json()
    body = bodySchema.parse(raw)
  } catch {
    return errorResponse(400, 'VALIDATION_FAILED', 'i18n:errors.validation_failed', rid)
  }

  const { container_ids, format } = body

  // Fetch containers and their products in parallel
  const { data: containers, error: cErr } = await supabase
    .from('containers')
    .select('id, product_id, batch_number, manufacture_date, formulation_expires_at')
    .in('id', container_ids)

  if (cErr || !containers) {
    console.error('[api/containers/export-labels] fetch failed', { rid, message: cErr?.message })
    return errorResponse(500, 'INTERNAL_ERROR', 'i18n:errors.internal_error', rid)
  }

  if (containers.length === 0) {
    return errorResponse(404, 'NOT_FOUND', 'No matching containers found.', rid)
  }

  // Resolve product names + FPA details
  const productIds = [...new Set(containers.map((c) => c.product_id))]
  const productMap = new Map<
    string,
    { product_name: string; company: string; fpa_registration_number: string | null }
  >()

  const { data: products } = await supabase
    .from('products')
    .select('id, product_name, company, fpa_registration_number')
    .in('id', productIds)

  for (const p of products ?? []) {
    productMap.set(p.id, {
      product_name: p.product_name,
      company: p.company,
      fpa_registration_number: p.fpa_registration_number ?? null,
    })
  }

  const enriched = containers.map((c) => ({
    ...c,
    product_name: productMap.get(c.product_id)?.product_name ?? null,
    company: productMap.get(c.product_id)?.company ?? null,
    fpa_registration_number: productMap.get(c.product_id)?.fpa_registration_number ?? null,
  }))

  const date = new Date().toISOString().slice(0, 10)
  const filename = `labels-${date}.${format}`

  if (format === 'zpl') {
    const zpl = enriched.map(buildZplLabel).join('\n')
    const bytes = new TextEncoder().encode(zpl)

    return new NextResponse(bytes, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.zebra-zpl',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': String(bytes.byteLength),
      },
    })
  }

  // PDF
  const pdfBytes = buildPdfBytes(enriched)

  return new NextResponse(pdfBytes, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(pdfBytes.byteLength),
    },
  })
}
