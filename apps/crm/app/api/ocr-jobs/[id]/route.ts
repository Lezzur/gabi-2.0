import { type NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createServerClient } from '@gaia/supabase'
import { reqId, errorResponse } from '@/lib/api'
import { getOcrJob } from '@/lib/ocr/jobs'

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } },
) {
  const rid = reqId()
  const cookieStore = cookies()
  const supabase = createServerClient(cookieStore)

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return errorResponse(401, 'AUTH_REQUIRED', 'i18n:errors.auth_required', rid)

  const job = await getOcrJob(params.id, user.id)
  if (!job) return errorResponse(404, 'NOT_FOUND', 'i18n:errors.not_found', rid)

  return NextResponse.json({ data: job, meta: { request_id: rid } })
}
