import { describe, it, expect } from 'vitest'

describe('smoke', () => {
  it('vitest is working', () => {
    expect(1 + 1).toBe(2)
  })

  it('NODE_ENV is test', () => {
    expect(process.env.NODE_ENV).toBe('test')
  })
})
