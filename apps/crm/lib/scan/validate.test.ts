import { describe, it, expect } from 'vitest'
import { validateClockBounds, parseScanRequest } from './validate'

const NOW = new Date('2026-01-15T12:00:00.000Z')
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000

function ago(ms: number): string {
  return new Date(NOW.getTime() - ms).toISOString()
}
function ahead(ms: number): string {
  return new Date(NOW.getTime() + ms).toISOString()
}

describe('validateClockBounds', () => {
  it('accepts a timestamp 30 seconds in the past', () => {
    expect(validateClockBounds(ago(30_000), null, NOW)).toEqual({ ok: true })
  })

  it('accepts a timestamp exactly at server now', () => {
    expect(validateClockBounds(NOW.toISOString(), null, NOW)).toEqual({ ok: true })
  })

  it('rejects a future timestamp (1 second ahead)', () => {
    expect(validateClockBounds(ahead(1_000), null, NOW)).toEqual({
      ok: false,
      code: 'FUTURE_TIMESTAMP',
    })
  })

  it('rejects a timestamp older than 7 days', () => {
    const eightDaysAgo = ago(8 * 24 * 60 * 60 * 1000)
    expect(validateClockBounds(eightDaysAgo, null, NOW)).toEqual({
      ok: false,
      code: 'STALE_OFFLINE',
    })
  })

  it('accepts a timestamp exactly at the 7-day boundary', () => {
    // Exactly 7 days ago is still valid (boundary is exclusive)
    const exactBoundary = ago(SEVEN_DAYS_MS)
    expect(validateClockBounds(exactBoundary, null, NOW).ok).toBe(true)
  })

  it('rejects local_scan_ts before last_online_ts (clock rollback)', () => {
    const lastOnline = ago(60_000)   // 1 min ago
    const scanTs = ago(120_000)      // 2 min ago — BEFORE last_online_ts
    expect(validateClockBounds(scanTs, lastOnline, NOW)).toEqual({
      ok: false,
      code: 'CLOCK_SKEW',
    })
  })

  it('accepts local_scan_ts equal to last_online_ts', () => {
    const ts = ago(60_000)
    expect(validateClockBounds(ts, ts, NOW)).toEqual({ ok: true })
  })

  it('accepts local_scan_ts after last_online_ts', () => {
    const lastOnline = ago(120_000)
    const scanTs = ago(60_000)       // 60s after lastOnline
    expect(validateClockBounds(scanTs, lastOnline, NOW)).toEqual({ ok: true })
  })

  it('returns CLOCK_SKEW for a non-parseable local_scan_ts', () => {
    expect(validateClockBounds('not-a-date', null, NOW)).toEqual({
      ok: false,
      code: 'CLOCK_SKEW',
    })
  })
})

describe('parseScanRequest', () => {
  const base = {
    uuid: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
    hmac: 'abcdef1234567890',
    step: 'purchase_farmer',
    actor_type: 'farmer',
  }

  it('accepts a minimal valid request', () => {
    const result = parseScanRequest(base)
    expect(result.ok).toBe(true)
  })

  it('rejects an invalid UUID', () => {
    const result = parseScanRequest({ ...base, uuid: 'not-a-uuid' })
    expect(result.ok).toBe(false)
  })

  it('rejects a short HMAC', () => {
    const result = parseScanRequest({ ...base, hmac: 'abc' })
    expect(result.ok).toBe(false)
  })

  it('rejects an unknown step', () => {
    const result = parseScanRequest({ ...base, step: 'invalid_step' })
    expect(result.ok).toBe(false)
  })

  it('rejects extra fields (strict mode)', () => {
    const result = parseScanRequest({ ...base, extra: 'field' })
    expect(result.ok).toBe(false)
  })
})
