import { NextResponse } from 'next/server'

/** Generates an opaque request ID like `req_a1b2c3d4`. */
export function reqId(): string {
  return `req_${crypto.randomUUID().replace(/-/g, '').slice(0, 8)}`
}

/** Builds a standardised error envelope per api-spec §2.2. */
export function errorResponse(
  status: number,
  code: string,
  message: string,
  request_id: string,
  details?: unknown,
): NextResponse {
  return NextResponse.json(
    {
      error: {
        code,
        message,
        ...(details !== undefined && { details }),
        request_id,
      },
    },
    { status },
  )
}

/** Encodes a cursor from (updated_at, id) → opaque base64 string. */
export function encodeCursor(updatedAt: string, id: string): string {
  return Buffer.from(JSON.stringify({ c: updatedAt, i: id })).toString('base64')
}

/**
 * Decodes a cursor string. Returns null if the value is not valid base64(JSON)
 * with string `c` and `i` fields.
 */
export function decodeCursor(cursor: string): { c: string; i: string } | null {
  try {
    const raw: unknown = JSON.parse(Buffer.from(cursor, 'base64').toString('utf8'))
    if (
      typeof raw !== 'object' ||
      raw === null ||
      typeof (raw as Record<string, unknown>).c !== 'string' ||
      typeof (raw as Record<string, unknown>).i !== 'string'
    ) {
      return null
    }
    return raw as { c: string; i: string }
  } catch {
    return null
  }
}

/**
 * Sanitises a free-text search term for use in a PostgREST ILIKE filter:
 *  - strips ILIKE wildcards (%, _)
 *  - strips PostgREST OR/grouping delimiters (, ( ))
 *  - trims whitespace
 *  - caps at 200 characters
 */
export function sanitiseSearch(raw: string): string {
  return raw
    .replace(/[%_,()'"`\\]/g, '')
    .trim()
    .slice(0, 200)
}
