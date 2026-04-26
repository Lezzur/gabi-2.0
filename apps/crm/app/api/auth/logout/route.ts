import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createServerClient } from '@gaia/supabase'
import { reqId } from '@/lib/api'

export async function POST() {
  const rid = reqId()
  const cookieStore = cookies()
  const supabase = createServerClient(cookieStore)

  await supabase.auth.signOut()

  return NextResponse.json({ meta: { request_id: rid } })
}
