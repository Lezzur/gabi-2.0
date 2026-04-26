'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { createServerClient } from '@gaia/supabase'
import { checkRateLimit } from '@/lib/rate-limit'

export async function loginAction(formData: FormData) {
  const email = (formData.get('email') as string | null)?.trim() ?? ''
  const password = (formData.get('password') as string | null) ?? ''
  const next = (formData.get('next') as string | null) ?? '/'

  if (!email || !password) {
    return { error: 'Invalid credentials.' }
  }

  // Rate limit: 5 attempts per email per 15 minutes
  const allowed = checkRateLimit(`login:${email.toLowerCase()}`, 5, 15 * 60 * 1000)
  if (!allowed) {
    return { error: 'Too many login attempts. Please try again later.' }
  }

  const cookieStore = cookies()
  const supabase = createServerClient(cookieStore)

  const { error } = await supabase.auth.signInWithPassword({ email, password })

  if (error) {
    // Generic message for both unknown email and wrong password (prevents enumeration)
    return { error: 'Invalid credentials.' }
  }

  // Refresh session to pick up custom JWT claims from auth hook
  await supabase.auth.refreshSession()

  redirect(next.startsWith('/') ? next : '/')
}
