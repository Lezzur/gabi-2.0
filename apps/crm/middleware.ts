import { type NextRequest, NextResponse } from 'next/server'
import { createServerClient as createSupabaseEdgeClient } from '@supabase/ssr'

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon\\.ico).*)'],
}

const PUBLIC_PATHS = ['/login', '/public']
const AUTH_API_PREFIX = '/api/auth'

const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
  "frame-ancestors 'none'",
].join('; ')

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  const response = NextResponse.next({
    request: { headers: request.headers },
  })

  response.headers.set('X-Frame-Options', 'DENY')
  response.headers.set('Content-Security-Policy', CSP)

  if (
    PUBLIC_PATHS.some((p) => pathname.startsWith(p)) ||
    pathname.startsWith(AUTH_API_PREFIX)
  ) {
    return response
  }

  const supabase = createSupabaseEdgeClient(
    process.env['NEXT_PUBLIC_SUPABASE_URL'] ?? process.env['SUPABASE_URL'] ?? '',
    process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'] ?? process.env['SUPABASE_ANON_KEY'] ?? '',
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet: Array<{ name: string; value: string; options: Record<string, unknown> }>) {
          cookiesToSet.forEach(({ name, value, options }) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            ;(response.cookies.set as (name: string, value: string, options?: any) => void)(name, value, options)
          })
        },
      },
    },
  )

  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    if (pathname.startsWith('/api/')) {
      // API clients (mobile app) authenticate with a Bearer token, which
      // every route handler validates itself — pass those through. Anything
      // else gets a JSON 401: an HTML login redirect is wrong for
      // programmatic clients.
      if (request.headers.get('authorization')?.toLowerCase().startsWith('bearer ')) {
        return response
      }
      return NextResponse.json(
        { error: { code: 'AUTH_REQUIRED', message: 'i18n:errors.auth_required' } },
        { status: 401 },
      )
    }
    const loginUrl = request.nextUrl.clone()
    loginUrl.pathname = '/login'
    loginUrl.searchParams.set('next', pathname)
    return NextResponse.redirect(loginUrl)
  }

  return response
}
