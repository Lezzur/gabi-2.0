import { createServerClient as _createServerClient } from '@supabase/ssr'
import type { CookieOptions } from '@supabase/ssr'
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './env'
import type { Database } from './types'

interface CookieStore {
  getAll(): Array<{ name: string; value: string }>
  set(name: string, value: string, options?: CookieOptions): void
}

export function createServerClient(cookieStore: CookieStore) {
  return _createServerClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => {
          try {
            cookieStore.set(name, value, {
              ...options,
              httpOnly: true,
              sameSite: 'lax',
              secure: process.env['NODE_ENV'] === 'production',
            })
          } catch {
            // Server Components cannot set cookies — silently skip.
            // Auth state mutations only happen in Route Handlers and Server Actions.
          }
        })
      },
    },
  })
}
