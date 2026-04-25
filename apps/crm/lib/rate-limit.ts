// Sliding-window rate limiter backed by in-process memory.
// Works correctly for single-instance deployments.
// For multi-node setups, replace the Map with a shared store (e.g. Upstash Redis).
const store = new Map<string, number[]>()

export function checkRateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now()
  const prev = store.get(key) ?? []
  const hits = prev.filter((t) => now - t < windowMs)
  if (hits.length >= limit) return false
  hits.push(now)
  store.set(key, hits)
  return true
}
