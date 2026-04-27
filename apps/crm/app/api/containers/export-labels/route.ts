import { type NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { z } from 'zod'
import { createServerClient, createServiceClient } from '@gaia/supabase'
import { reqId, errorResponse } from '@/lib/api'
import PDFDocument from 'pdfkit'
import QRCode from 'qrcode'

const ALLOWED_ROLES = ['gabs_admin', 'brand_admin'] as const
const MAX_EXPORT = 5_000
const LABELS_PER_PAGE = 24
const LABEL_COLS = 4
const LABEL_ROWS = 6

// A4 in points (1 pt = 1/72 inch)
const PAGE_W = 595.28
const PAGE_H = 841.89
const PAGE_MARGIN = 12

// QR code source resolution for PDFKit's image() — rendered at QR_DISPLAY_PTS.
// Error correction level H (30% codeword recovery) is required because
// agrichemical labels are handled outdoors: dust, handling marks, and partial
// chemical contamination routinely degrade QR surface area. Level H keeps
// scans reliable in field conditions even when up to 30% of the code is obscured.
const QR_SRC_PX = 300
const QR_DISPLAY_PTS = 90

// ZD421 at 203 dpi — 2-inch wide label stock = 406 dots
const ZPL_PRINT_WIDTH = 406
const ZPL_LABEL_HEIGHT = 406

const bodySchema = z.object({
  batch_id: z.string().uuid(),
  format: z.enum(['pdf', 'zpl']),
})

type Container = {
  id: string
  hmac_suffix: string
  batch_number: string | null
  manufacture_date: string | null
  formulation_expires_at: string | null
}

type Product = {
  product_name: string
  company: string
  active_ingredient: string
  concentration: string | null
  formulation_type: string | null
  fpa_registration_number: string | null
  fpa_registration_expires_at: string | null
  category: string | null
  pre_harvest_interval: string | null
  re_entry_period: string | null
}

function scanUrl(c: Container): string {
  return `https://gaia.ph/scan/${c.id}.${c.hmac_suffix}`
}

// ── ZPL ──────────────────────────────────────────────────────────────────────

function zplLabel(c: Container, p: Product): string {
  // ^BQN,2,4,H — QR Code: normal orientation, model 2, mag 4 dots/module, H error correction.
  // Magnification 4 gives ~132–164 dots for the URL length; fits 2-inch stock width of 406 dots.
  // Text fields sit to the right of the QR column (x=155) to keep both elements visible.
  const url = scanUrl(c)
  const name = p.product_name.slice(0, 38)
  return [
    '^XA',
    `^PW${ZPL_PRINT_WIDTH}`,
    `^LL${ZPL_LABEL_HEIGHT}`,
    `^FO20,20^BQN,2,4,H^FDQA,${url}^FS`,
    `^FO155,25^A0N,22,22^FD${name}^FS`,
    `^FO155,55^A0N,18,18^FDBatch: ${c.batch_number ?? ''}^FS`,
    `^FO155,85^A0N,18,18^FDFPA: ${p.fpa_registration_number ?? ''}^FS`,
    c.manufacture_date
      ? `^FO155,115^A0N,18,18^FDMfg: ${c.manufacture_date}^FS`
      : '',
    c.formulation_expires_at
      ? `^FO155,145^A0N,18,18^FDExp: ${c.formulation_expires_at}^FS`
      : '',
    '^XZ',
  ]
    .filter(Boolean)
    .join('\n')
}

// ── PDF helpers ───────────────────────────────────────────────────────────────

function renderPdfLabel(
  doc: PDFKit.PDFDocument,
  c: Container,
  qrImage: Buffer,
  p: Product,
  indexOnPage: number,
): void {
  const col = indexOnPage % LABEL_COLS
  const row = Math.floor(indexOnPage / LABEL_COLS)

  const cellW = (PAGE_W - 2 * PAGE_MARGIN) / LABEL_COLS
  const cellH = (PAGE_H - 2 * PAGE_MARGIN) / LABEL_ROWS
  const cellX = PAGE_MARGIN + col * cellW
  const cellY = PAGE_MARGIN + row * cellH

  // Light cut guide
  doc.rect(cellX, cellY, cellW, cellH).stroke('#e0e0e0')

  // QR code — centred horizontally in label cell
  const qrX = cellX + (cellW - QR_DISPLAY_PTS) / 2
  const qrY = cellY + 4
  doc.image(qrImage, qrX, qrY, { width: QR_DISPLAY_PTS, height: QR_DISPLAY_PTS })

  // Text block below QR
  const textX = cellX + 3
  const textW = cellW - 6
  let textY = qrY + QR_DISPLAY_PTS + 3
  const LINE = 9

  doc.fontSize(7).fillColor('#000000').text(p.product_name, textX, textY, {
    width: textW,
    lineBreak: false,
    ellipsis: true,
  })
  textY += LINE

  if (c.batch_number) {
    doc.fontSize(6).text(`Batch: ${c.batch_number}`, textX, textY, {
      width: textW,
      lineBreak: false,
      ellipsis: true,
    })
    textY += LINE
  }

  if (c.manufacture_date) {
    doc.fontSize(6).text(`Mfg: ${c.manufacture_date}`, textX, textY, {
      width: textW,
      lineBreak: false,
    })
    textY += LINE
  }

  if (c.formulation_expires_at) {
    doc.fontSize(6).text(`Exp: ${c.formulation_expires_at}`, textX, textY, {
      width: textW,
      lineBreak: false,
    })
  }
}

// Creates a ReadableStream that yields the PDF incrementally, one page-batch at
// a time. PDFKit flushes each page's binary data when the next page starts (or
// on end()), so memory at any moment holds at most one page-worth of QR buffers
// (24 × ~10 KB ≈ 240 KB) plus PDFKit's internal page buffer.
//
// If rendering fails after the Response headers are already sent, the stream is
// aborted (connection closed) — the caller catches synchronous setup errors and
// returns a 500 before any bytes reach the client.
function createPdfStream(containers: Container[], product: Product): ReadableStream<Uint8Array> {
  const doc = new PDFDocument({ size: 'A4', margin: 0, autoFirstPage: false })

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      doc.on('data', (chunk: Buffer) => controller.enqueue(new Uint8Array(chunk)))
      doc.on('end', () => controller.close())
      doc.on('error', (err: Error) => controller.error(err))

      try {
        for (let pageStart = 0; pageStart < containers.length; pageStart += LABELS_PER_PAGE) {
          const batch = containers.slice(pageStart, pageStart + LABELS_PER_PAGE)
          doc.addPage({ size: 'A4', margin: 0 })

          // Pre-generate all QR buffers for this page concurrently, then render
          // synchronously into PDFKit (doc.image() is not async-safe).
          const qrBuffers = await Promise.all(
            batch.map((c) =>
              QRCode.toBuffer(scanUrl(c), {
                width: QR_SRC_PX,
                errorCorrectionLevel: 'H',
                type: 'png',
                margin: 1,
              }),
            ),
          )

          for (let i = 0; i < batch.length; i++) {
            renderPdfLabel(doc, batch[i], qrBuffers[i], product, i)
          }
        }

        doc.end()
      } catch (err) {
        doc.destroy()
        controller.error(err)
      }
    },
  })
}

// ── Route ─────────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest): Promise<Response> {
  const rid = reqId()

  // ── Auth ────────────────────────────────────────────────────────────────────
  const cookieStore = cookies()
  const supabase = createServerClient(cookieStore)
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return errorResponse(401, 'AUTH_REQUIRED', 'i18n:errors.auth_required', rid)

  const userRole = (user.app_metadata?.['user_role'] ?? '') as string
  if (!(ALLOWED_ROLES as readonly string[]).includes(userRole)) {
    return errorResponse(403, 'FORBIDDEN', 'i18n:errors.forbidden', rid)
  }

  // ── Body validation ─────────────────────────────────────────────────────────
  let body: z.infer<typeof bodySchema>
  try {
    body = bodySchema.parse(await request.json())
  } catch {
    return errorResponse(400, 'VALIDATION_FAILED', 'i18n:errors.validation_failed', rid)
  }

  const svc = createServiceClient()

  // ── Batch lookup ────────────────────────────────────────────────────────────
  const { data: batch, error: batchErr } = await svc
    .from('batch_generation_log')
    .select('batch_id, product_id, quantity')
    .eq('batch_id', body.batch_id)
    .maybeSingle()

  if (batchErr) {
    console.error('[export-labels] batch lookup failed', { rid, message: batchErr.message })
    return errorResponse(500, 'INTERNAL_ERROR', 'i18n:errors.internal_error', rid)
  }
  if (!batch) return errorResponse(404, 'BATCH_NOT_FOUND', 'i18n:errors.batch_not_found', rid)

  // ── Export size guard ───────────────────────────────────────────────────────
  if (batch.quantity > MAX_EXPORT) {
    return NextResponse.json(
      {
        error: {
          code: 'EXPORT_TOO_LARGE',
          message: 'i18n:errors.export_too_large',
          details: { limit: MAX_EXPORT, actual: batch.quantity },
          request_id: rid,
        },
      },
      { status: 413 },
    )
  }

  // ── Fetch containers + product concurrently ─────────────────────────────────
  const [containersResult, productResult] = await Promise.all([
    svc
      .from('containers')
      .select('id, hmac_suffix, batch_number, manufacture_date, formulation_expires_at')
      // batch_number stores the batch UUID (set by /generate).
      // product_id is the leading column of idx_containers_batch_number.
      .eq('product_id', batch.product_id)
      .eq('batch_number', batch.batch_id)
      .limit(MAX_EXPORT),
    svc
      .from('products')
      .select(
        'product_name, company, active_ingredient, concentration, formulation_type,' +
          ' fpa_registration_number, fpa_registration_expires_at, category,' +
          ' pre_harvest_interval, re_entry_period',
      )
      .eq('id', batch.product_id)
      .single(),
  ])

  if (containersResult.error) {
    console.error('[export-labels] containers query failed', {
      rid,
      message: containersResult.error.message,
    })
    return errorResponse(500, 'INTERNAL_ERROR', 'i18n:errors.internal_error', rid)
  }
  if (!productResult.data) {
    return errorResponse(404, 'PRODUCT_NOT_FOUND', 'i18n:errors.product_not_found', rid)
  }

  const containers = containersResult.data as Container[]
  const product = productResult.data as Product

  console.info('[export-labels] export initiated', {
    rid,
    batch_id: body.batch_id,
    format: body.format,
    container_count: containers.length,
    user_id: user.id,
  })

  // ── ZPL ─────────────────────────────────────────────────────────────────────
  if (body.format === 'zpl') {
    const zpl = containers.map((c) => zplLabel(c, product)).join('\n')
    return new Response(zpl, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Disposition': `attachment; filename="labels-${body.batch_id}.zpl"`,
        'Cache-Control': 'no-store',
        'X-Request-Id': rid,
      },
    })
  }

  // ── PDF ──────────────────────────────────────────────────────────────────────
  // Synchronous setup errors (PDFDocument constructor, etc.) are caught here and
  // converted to a 500 before any headers are sent to the client. Async rendering
  // errors that occur after the stream starts will abort the connection — they are
  // logged server-side and no PDFKit internals are forwarded to the client.
  try {
    const pdfStream = createPdfStream(containers, product)
    return new Response(pdfStream, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="labels-${body.batch_id}.pdf"`,
        'Cache-Control': 'no-store',
        'X-Request-Id': rid,
      },
    })
  } catch (err) {
    console.error('[export-labels] PDF stream setup failed', { rid, error: String(err) })
    return errorResponse(500, 'INTERNAL_ERROR', 'i18n:errors.internal_error', rid)
  }
}
