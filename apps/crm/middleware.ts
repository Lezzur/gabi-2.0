import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

// Placeholder — real auth middleware implemented in p3-auth-middleware
export function middleware(_request: NextRequest) {
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon\\.ico|api/).*)'],
};
