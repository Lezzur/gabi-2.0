import { cookies } from 'next/headers'
import type { NextRequest } from 'next/server'
import type { User } from '@supabase/supabase-js'
import { createServerClient } from '@gaia/supabase'

/**
 * Resolves the authenticated user for an API route from either auth
 * transport: `Authorization: Bearer <jwt>` (mobile app, validated against
 * the auth server) or the SSR session cookie (CRM browser). Bearer wins
 * when both are present.
 */
export async function getRequestUser(request: NextRequest): Promise<User | null> {
  const supabase = createServerClient(cookies())

  const header = request.headers.get('authorization')
  if (header?.toLowerCase().startsWith('bearer ')) {
    const token = header.slice(7).trim()
    const { data: { user } } = await supabase.auth.getUser(token)
    return user
  }

  const { data: { user } } = await supabase.auth.getUser()
  return user
}
