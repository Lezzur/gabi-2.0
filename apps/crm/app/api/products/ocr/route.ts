import { type NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { z } from 'zod'
import { createServerClient, createServiceClient } from '@gaia/supabase'
import { reqId, errorResponse } from '@/lib/api'
import { createOcrJob } from '@/lib/ocr/jobs'

const bodySchema = z.object({
  filename: z.string().min(1).max(200),
  content_type: z.string().regex(/^image\//),
})

export async function POST(request: NextRequest) {
  const rid = reqId()
  const cookieStore = cookies()
  const supabase = createServerClient(cookieStore)

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return errorResponse(401, 'AUTH_REQUIRED', 'i18n:errors.auth_required', rid)

  let body: z.infer<typeof bodySchema>
  try {
    const raw: unknown = await request.json()
    body = bodySchema.parse(raw)
  } catch {
    return errorResponse(400, 'VALIDATION_FAILED', 'i18n:errors.validation_failed', rid)
  }

  // Create a signed upload URL for Supabase Storage.
  // Bucket policy enforces image/* content type and 10 MB max size.
  const objectPath = `${user.id}/${crypto.randomUUID()}-${body.filename}`
  const db = createServiceClient()
  const { data: signed, error: signErr } = await db.storage
    .from('ocr-uploads')
    .createSignedUploadUrl(objectPath)

  if (signErr || !signed) {
    return errorResponse(500, 'INTERNAL_ERROR', 'i18n:errors.internal_error', rid)
  }

  // Public URL the OCR adapter will download from (accessible server-side).
  const { data: publicData } = db.storage.from('ocr-uploads').getPublicUrl(objectPath)
  const imageUrl = publicData.publicUrl

  let jobId: string
  try {
    jobId = await createOcrJob(user.id, imageUrl)
  } catch {
    return errorResponse(500, 'INTERNAL_ERROR', 'i18n:errors.internal_error', rid)
  }

  return NextResponse.json(
    { job_id: jobId, upload_url: signed.signedUrl, object_path: objectPath },
    { status: 202 },
  )
}
