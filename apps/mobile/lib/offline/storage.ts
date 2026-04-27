import AsyncStorage from '@react-native-async-storage/async-storage'

const QUEUE_KEY = 'gaia:offline:queue'
const LOG_KEY = 'gaia:offline:sync-log'

const MAX_QUEUE_SIZE = 200
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000  // 7 days — mirrors server-side cap

export type ScanStep = 'purchase_dealer' | 'purchase_farmer' | 'return_dealer' | 'return_farmer'

export interface QueuedScan {
  id: string              // client-generated uuid v4 — stable across retries
  uuid: string            // container uuid from QR code
  hmac: string            // 16-char HMAC suffix from QR code
  step: ScanStep
  local_scan_ts: string   // ISO timestamp of the original scan
  last_online_ts: string  // ISO timestamp of last confirmed network ping
  idempotency_key: string // uuid v4, one per queued scan, sent on every retry
  attempts: number
  last_error?: string
}

export interface SyncLogEntry {
  scan_id: string
  outcome: 'success' | 'terminal_error' | 'retryable_error' | 'dropped_too_old'
  timestamp: string
  detail?: string
}

async function readQueue(): Promise<QueuedScan[]> {
  const raw = await AsyncStorage.getItem(QUEUE_KEY)
  if (!raw) return []
  try {
    return JSON.parse(raw) as QueuedScan[]
  } catch {
    return []
  }
}

async function writeQueue(queue: QueuedScan[]): Promise<void> {
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue))
}

/**
 * Adds a scan to the offline queue.
 * Throws if the queue has reached MAX_QUEUE_SIZE — the caller should surface
 * a "Queue full — please sync before scanning offline" warning to the user.
 */
export async function enqueue(scan: QueuedScan): Promise<void> {
  const queue = await readQueue()
  if (queue.length >= MAX_QUEUE_SIZE) {
    throw new Error(`Offline queue full (${MAX_QUEUE_SIZE} scans). Sync before scanning offline.`)
  }
  queue.push(scan)
  await writeQueue(queue)
}

/**
 * Removes a scan from the queue by its client id.
 */
export async function dequeue(id: string): Promise<void> {
  const queue = await readQueue()
  await writeQueue(queue.filter((s) => s.id !== id))
}

/**
 * Returns all queued scans ordered oldest-first (insertion order).
 * Also drops any entries older than MAX_AGE_MS and logs them as dropped.
 */
export async function listQueue(): Promise<QueuedScan[]> {
  const queue = await readQueue()
  const now = Date.now()
  const fresh: QueuedScan[] = []
  const dropped: QueuedScan[] = []

  for (const scan of queue) {
    const age = now - Date.parse(scan.local_scan_ts)
    if (age > MAX_AGE_MS) {
      dropped.push(scan)
    } else {
      fresh.push(scan)
    }
  }

  if (dropped.length > 0) {
    await writeQueue(fresh)
    await Promise.all(
      dropped.map((s) =>
        appendLog({
          scan_id: s.id,
          outcome: 'dropped_too_old',
          timestamp: new Date().toISOString(),
          detail: `local_scan_ts=${s.local_scan_ts}`,
        }),
      ),
    )
  }

  return fresh
}

/**
 * Updates attempts count and last_error for a queued scan after a retry.
 */
export async function updateAttempt(id: string, result: { error?: string }): Promise<void> {
  const queue = await readQueue()
  const idx = queue.findIndex((s) => s.id === id)
  if (idx === -1) return

  queue[idx] = {
    ...queue[idx]!,
    attempts: (queue[idx]!.attempts ?? 0) + 1,
    last_error: result.error,
  }
  await writeQueue(queue)
}

async function appendLog(entry: SyncLogEntry): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(LOG_KEY)
    const log: SyncLogEntry[] = raw ? (JSON.parse(raw) as SyncLogEntry[]) : []
    log.push(entry)
    // Keep the last 500 log entries to bound storage use.
    const trimmed = log.slice(-500)
    await AsyncStorage.setItem(LOG_KEY, JSON.stringify(trimmed))
  } catch {
    // Log write failures are silently swallowed — the queue itself is more important.
  }
}

export { appendLog }
