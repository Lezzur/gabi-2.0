import { describe, it, expect, vi } from 'vitest'
import {
  claimPurchaseByFarmer,
  claimReturnByDealer,
  writePendingReturnReward,
} from './claim'
import type { SupabaseClient } from '@supabase/supabase-js'

// ─── Supabase query builder mock ─────────────────────────────────────────────

function makeChain(result: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {}
  const methods = ['from', 'update', 'insert', 'select', 'eq', 'is', 'single', 'maybeSingle']
  methods.forEach((m) => {
    chain[m] = vi.fn(() => chain)
  })
  // Terminal .select() resolves to the result
  ;(chain['select'] as ReturnType<typeof vi.fn>).mockResolvedValue(result)
  ;(chain['single'] as ReturnType<typeof vi.fn>).mockResolvedValue(result)
  ;(chain['maybeSingle'] as ReturnType<typeof vi.fn>).mockResolvedValue(result)
  return chain
}

function makeClient(result: { data: unknown; error: unknown }) {
  const chain = makeChain(result)
  return { from: vi.fn(() => chain) } as unknown as SupabaseClient
}

const CONTAINER_ID = 'f47ac10b-58cc-4372-a567-0e02b2c3d479'
const FARMER_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'
const DEALER_USER_ID = 'b1ffcd00-0d1c-5ef9-cc7e-7ccace491b22'
const DEALER_ACCOUNT_ID = 'c2aade11-1e2d-6fg0-dd8f-8ddbdf502c33'
const SCAN_TS = '2026-01-15T12:00:00.000Z'

// ─── claimPurchaseByFarmer ────────────────────────────────────────────────────

describe('claimPurchaseByFarmer', () => {
  it('returns { claimed: true } when the UPDATE matches one row', async () => {
    const client = makeClient({ data: [{ id: CONTAINER_ID }], error: null })
    const result = await claimPurchaseByFarmer(CONTAINER_ID, FARMER_ID, SCAN_TS, client)
    expect(result).toEqual({ claimed: true })
  })

  it('returns { claimed: false, reason: ALREADY_CLAIMED } when UPDATE matches 0 rows', async () => {
    const client = makeClient({ data: [], error: null })
    const result = await claimPurchaseByFarmer(CONTAINER_ID, FARMER_ID, SCAN_TS, client)
    expect(result).toEqual({ claimed: false, reason: 'ALREADY_CLAIMED' })
  })

  it('throws when the DB returns an error', async () => {
    const client = makeClient({ data: null, error: { message: 'db error', code: '500' } })
    await expect(claimPurchaseByFarmer(CONTAINER_ID, FARMER_ID, SCAN_TS, client)).rejects.toThrow()
  })

  // Concurrency: two simultaneous claims — exactly one should win
  it('concurrent claims — only one wins (Promise.all)', async () => {
    let callCount = 0
    // First call returns a row (wins); second returns empty (loses)
    const results = [
      { data: [{ id: CONTAINER_ID }], error: null },
      { data: [], error: null },
    ]

    const clientFn = () => {
      const r = results[callCount++]!
      return makeClient(r)
    }

    const [r1, r2] = await Promise.all([
      claimPurchaseByFarmer(CONTAINER_ID, FARMER_ID, SCAN_TS, clientFn()),
      claimPurchaseByFarmer(CONTAINER_ID, FARMER_ID, SCAN_TS, clientFn()),
    ])

    const winners = [r1, r2].filter((r) => r.claimed)
    const losers = [r1, r2].filter((r) => !r.claimed)
    expect(winners).toHaveLength(1)
    expect(losers).toHaveLength(1)
  })
})

// ─── claimReturnByDealer ─────────────────────────────────────────────────────

describe('claimReturnByDealer', () => {
  it('returns { claimed: true } when UPDATE matches one row', async () => {
    const client = makeClient({ data: [{ id: CONTAINER_ID }], error: null })
    const result = await claimReturnByDealer(CONTAINER_ID, DEALER_USER_ID, DEALER_ACCOUNT_ID, SCAN_TS, client)
    expect(result).toEqual({ claimed: true })
  })

  it('returns { claimed: false } when UPDATE matches 0 rows (already returned)', async () => {
    const client = makeClient({ data: [], error: null })
    const result = await claimReturnByDealer(CONTAINER_ID, DEALER_USER_ID, DEALER_ACCOUNT_ID, SCAN_TS, client)
    expect(result).toEqual({ claimed: false, reason: 'ALREADY_CLAIMED' })
  })
})

// ─── writePendingReturnReward ─────────────────────────────────────────────────

describe('writePendingReturnReward', () => {
  it('returns { written: true } with the new pending_id', async () => {
    const chain = makeChain({ data: { id: 'pending-uuid-123' }, error: null })
    const client = { from: vi.fn(() => chain) } as unknown as SupabaseClient
    const result = await writePendingReturnReward(CONTAINER_ID, DEALER_ACCOUNT_ID, client)
    expect(result).toEqual({ written: true, pending_id: 'pending-uuid-123' })
  })

  it('returns { written: false } on unique-violation (idempotent repeat)', async () => {
    const chain = makeChain({ data: null, error: { message: 'dup', code: '23505' } })
    const client = { from: vi.fn(() => chain) } as unknown as SupabaseClient
    const result = await writePendingReturnReward(CONTAINER_ID, DEALER_ACCOUNT_ID, client)
    expect(result).toEqual({ written: false, reason: 'ALREADY_CLAIMED' })
  })

  it('throws on non-constraint DB errors', async () => {
    const chain = makeChain({ data: null, error: { message: 'network error', code: '500' } })
    const client = { from: vi.fn(() => chain) } as unknown as SupabaseClient
    await expect(writePendingReturnReward(CONTAINER_ID, DEALER_ACCOUNT_ID, client)).rejects.toThrow()
  })
})
