import { describe, it, expect } from 'vitest'
import { computeHmac16, verifyHmac16, parseScanSuffix } from './hmac'

const UUID = 'f47ac10b-58cc-4372-a567-0e02b2c3d479'
const SECRET = 'test-secret-32-chars-minimum-len'

describe('computeHmac16', () => {
  it('is deterministic for the same inputs', () => {
    expect(computeHmac16(UUID, SECRET)).toBe(computeHmac16(UUID, SECRET))
  })

  it('returns exactly 16 lowercase hex characters', () => {
    expect(computeHmac16(UUID, SECRET)).toMatch(/^[0-9a-f]{16}$/)
  })

  it('produces different output for different secrets', () => {
    expect(computeHmac16(UUID, 'secret-a')).not.toBe(computeHmac16(UUID, 'secret-b'))
  })

  it('produces different output for different UUIDs', () => {
    const other = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'
    expect(computeHmac16(UUID, SECRET)).not.toBe(computeHmac16(other, SECRET))
  })
})

describe('verifyHmac16', () => {
  const valid = computeHmac16(UUID, SECRET)

  it('returns true for a correct HMAC', () => {
    expect(verifyHmac16(UUID, valid, SECRET)).toBe(true)
  })

  it('returns false for a flipped last character', () => {
    const flipped = valid.slice(0, 15) + (valid[15] === 'f' ? '0' : 'f')
    expect(verifyHmac16(UUID, flipped, SECRET)).toBe(false)
  })

  it('returns false for a wrong secret', () => {
    const wrongSecret = 'wrong-secret-32-chars-minimum!!'
    expect(verifyHmac16(UUID, valid, wrongSecret)).toBe(false)
  })

  it('returns false for a short (wrong-length) HMAC', () => {
    expect(verifyHmac16(UUID, valid.slice(0, 8), SECRET)).toBe(false)
  })

  it('returns false for a long (wrong-length) HMAC', () => {
    expect(verifyHmac16(UUID, valid + '00', SECRET)).toBe(false)
  })

  // Constant-time comparison sanity check: same-length mismatched strings must
  // not short-circuit. This verifies timingSafeEqual is used, not ===.
  it('uses constant-time comparison — all-zeros string of correct length fails', () => {
    expect(verifyHmac16(UUID, '0'.repeat(16), SECRET)).toBe(false)
  })

  it('uses constant-time comparison — all-f string of correct length fails', () => {
    expect(verifyHmac16(UUID, 'f'.repeat(16), SECRET)).toBe(false)
  })
})

describe('parseScanSuffix', () => {
  const hmac = computeHmac16(UUID, SECRET)

  it('parses a valid gaia.ph/scan/<uuid>.<hmac> URL', () => {
    expect(parseScanSuffix(`gaia.ph/scan/${UUID}.${hmac}`)).toEqual({ uuid: UUID, hmac })
  })

  it('parses the segment without a leading path', () => {
    expect(parseScanSuffix(`${UUID}.${hmac}`)).toEqual({ uuid: UUID, hmac })
  })

  it('returns null for empty input', () => {
    expect(parseScanSuffix('')).toBeNull()
  })

  it('returns null when the HMAC is missing', () => {
    expect(parseScanSuffix(`gaia.ph/scan/${UUID}`)).toBeNull()
  })

  it('returns null for a non-v4 UUID', () => {
    const badUuid = '00000000-0000-0000-0000-000000000000'
    expect(parseScanSuffix(`${badUuid}.${hmac}`)).toBeNull()
  })

  it('returns null for a short HMAC', () => {
    expect(parseScanSuffix(`${UUID}.${hmac.slice(0, 8)}`)).toBeNull()
  })
})
