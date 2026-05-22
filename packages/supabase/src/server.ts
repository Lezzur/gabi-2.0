import { createServerClient as _createServerClient } from '@supabase/ssr'
import type { SupabaseClient } from '@supabase/supabase-js'
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './env'
import type { Database } from './types'

// options typed as `any` so both ReadonlyRequestCookies (ResponseCookie) and
// ResponseCookies (CookieSerializeOptions) satisfy this interface without
// requiring imports from either Next.js or @supabase/ssr.
interface CookieStore {
  getAll(): Array<{ name: string; value: string }>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  set(name: string, value: string, options?: any): void
}

/**
 * Creates a Supabase client suitable for use in Server Components,
 * Route Handlers, and Server Actions. Automatically refreshes auth tokens
 * via the SSR cookie store.
 *
 * The return type is explicitly annotated as `SupabaseClient<Database>` so
 * TypeScript's PostgREST query type inference works correctly (using
 * `createClient`-style inference rather than the @supabase/ssr overload which
 * can produce `never` row types with hand-written Database types).
 */
export function createServerClient(cookieStore: CookieStore): SupabaseClient<Database> {
  return _createServerClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet: Array<{ name: string; value: string; options: Record<string, unknown> }>) {
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
  }) as unknown as SupabaseClient<Database>
}
