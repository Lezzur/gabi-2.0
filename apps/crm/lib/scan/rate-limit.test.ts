import { describe, it, expect, vi } from 'vitest'
import { checkRateLimit, recordInvalidHmac, resetRateLimit } from './rate-limit'
import type { SupabaseClient } from '@supabase/supabase-js'

const UUID = 'f47ac10b-58cc-4372-a567-0e02b2c3d479'

// ─── Mock factory ─────────────────────────────────────────────────────────────

function makeFromClient(result: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {}
  const methods = ['from', 'select', 'eq', 'delete', 'maybeSingle']
  methods.forEach((m) => { chain[m] = vi.fn(() => chain) })
  ;(chain['maybeSingle'] as ReturnType<typeof vi.fn>).mockResolvedValue(result)
  ;(chain['delete'] as ReturnType<typeof vi.fn>).mockResolvedValue(result)
  return { from: vi.fn(() => chain) } as unknown as SupabaseClient
}

function makeRpcClient(result: { data: unknown; error: unknown }) {
  return { rpc: vi.fn().mockResolvedValue(result) } as unknown as SupabaseClient
}

// ─── checkRateLimit ───────────────────────────────────────────────────────────

describe('checkRateLimit', () => {
  it('returns { locked: false } when no rate-limit row exists', async () => {
    const client = makeFromClient({ data: null, error: null })
    expect(await checkRateLimit(UUID, client)).toEqual({ locked: false })
  })

  it('returns { locked: false } when locked_until is null', async () => {
    const client = makeFromClient({ data: { locked_until: null }, error: null })
    expect(await checkRateLimit(UUID, client)).toEqual({ locked: false })
  })

  it('returns { locked: true } when locked_until is in the future', async () => {
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString()
    const client = makeFromClient({ data: { locked_until: future }, error: null })
    const result = await checkRateLimit(UUID, client)
    expect(result.locked).toBe(true)
    expect(result.retryAfterSec).toBeGreaterThan(0)
  })

  it('returns { locked: false } when locked_until is in the past (expired lock)', async () => {
    const past = new Date(Date.now() - 1000).toISOString()
    const client = makeFromClient({ data: { locked_until: past }, error: null })
    expect(await checkRateLimit(UUID, client)).toEqual({ locked: false })
  })

  it('fails closed (locked: true) when the DB returns an error', async () => {
    const client = makeFromClient({ data: null, error: { message: 'db down', code: '500' } })
    const result = await checkRateLimit(UUID, client)
    expect(result.locked).toBe(true)
    expect(result.retryAfterSec).toBeGreaterThan(0)
  })
})

// ─── recordInvalidHmac ────────────────────────────────────────────────────────

describe('recordInvalidHmac', () => {
  it('returns { locked: false } when the RPC reports not locked', async () => {
    const client = makeRpcClient({ data: [{ locked: false, retry_after_sec: null }], error: null })
    expect(await recordInvalidHmac(UUID, client)).toEqual({ locked: false })
  })

  it('returns { locked: true } with retry_after_sec when the 10th attempt triggers a lock', async () => {
    const client = makeRpcClient({ data: [{ locked: true, retry_after_sec: 3600 }], error: null })
    const result = await recordInvalidHmac(UUID, client)
    expect(result.locked).toBe(true)
    expect(result.retryAfterSec).toBe(3600)
  })

  it('fails closed when the RPC errors', async () => {
    const client = makeRpcClient({ data: null, error: { message: 'rpc error', code: '500' } })
    const result = await recordInvalidHmac(UUID, client)
    expect(result.locked).toBe(true)
  })

  it('lock persists — a locked UUID stays locked on subsequent reads', async () => {
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString()
    const readClient = makeFromClient({ data: { locked_until: future }, error: null })
    const result = await checkRateLimit(UUID, readClient)
    expect(result.locked).toBe(true)
  })
})

// ─── resetRateLimit ───────────────────────────────────────────────────────────

describe('resetRateLimit', () => {
  it('does not throw on success', async () => {
    const client = makeFromClient({ data: null, error: null })
    await expect(resetRateLimit(UUID, client)).resolves.toBeUndefined()
  })

  it('does not throw on DB error (best-effort cleanup)', async () => {
    const client = makeFromClient({ data: null, error: { message: 'db error', code: '500' } })
    await expect(resetRateLimit(UUID, client)).resolves.toBeUndefined()
  })
})
