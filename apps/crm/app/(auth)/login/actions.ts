'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { createServerClient } from '@gaia/supabase'
import { checkRateLimit } from '@/lib/rate-limit'

export interface LoginState {
  error?: string
}

function safeNext(raw: string): string {
  // Allow only same-origin absolute paths. Reject protocol-relative
  // (`//evil.com`), backslash-prefixed (`/\evil.com`), and anything not
  // starting with a single `/`.
  if (!raw.startsWith('/')) return '/'
  if (raw.startsWith('//') || raw.startsWith('/\\')) return '/'
  return raw
}

export async function loginAction(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const email = (formData.get('email') as string | null)?.trim() ?? ''
  const password = (formData.get('password') as string | null) ?? ''
  const next = safeNext((formData.get('next') as string | null) ?? '/')

  if (!email || !password) {
    return { error: 'Invalid credentials.' }
  }

  const allowed = checkRateLimit(`login:${email.toLowerCase()}`, 5, 15 * 60 * 1000)
  if (!allowed) {
    return { error: 'Too many login attempts. Please try again later.' }
  }

  const cookieStore = cookies()
  const supabase = createServerClient(cookieStore)

  const { error } = await supabase.auth.signInWithPassword({ email, password })

  if (error) {
    return { error: 'Invalid credentials.' }
  }

  await supabase.auth.refreshSession()

  redirect(next)
}
