// Offline queue flush — called whenever the app regains network connectivity.
//
// Invariants:
//   - Flush is serial (one scan at a time). Running two concurrent flushes
//     would race the same containers through the server state machine.
//   - Terminal errors (409 ALREADY_CLAIMED, 400 clock/stale errors) remove
//     the scan from the queue and log it — they will not succeed on retry.
//   - Retryable errors (5xx, network timeout) increment attempts. After 5
//     attempts the scan is surfaced to the user for manual retry or discard.
//   - The idempotency_key sent with every retry ensures the server never
//     double-credits a wallet even if a 200 response was lost in transit.

import type { SupabaseClient } from '@supabase/supabase-js'
import { listQueue, dequeue, updateAttempt, appendLog, type QueuedScan } from './storage'

const MAX_ATTEMPTS = 5
const TERMINAL_STATUS_CODES = new Set([409, 400])

const CRM_URL = (process.env['EXPO_PUBLIC_CRM_URL'] ?? '').replace(/\/$/, '')

interface ScanApiError {
  error?: { code?: string; message?: string }
}

async function postScan(
  scan: QueuedScan,
  accessToken: string,
): Promise<{ ok: true } | { ok: false; terminal: boolean; detail: string }> {
  let response: Response
  try {
    response = await fetch(`${CRM_URL}/api/scan`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        uuid: scan.uuid,
        hmac: scan.hmac,
        step: scan.step,
        local_scan_ts: scan.local_scan_ts,
        last_online_ts: scan.last_online_ts,
        idempotency_key: scan.idempotency_key,
      }),
    })
  } catch (err) {
    return { ok: false, terminal: false, detail: String(err) }
  }

  if (response.ok) return { ok: true }

  let body: ScanApiError = {}
  try {
    body = (await response.json()) as ScanApiError
  } catch {
    // ignore parse failure
  }

  const code = body.error?.code ?? `HTTP_${response.status}`
  const isTerminal = TERMINAL_STATUS_CODES.has(response.status)
  return { ok: false, terminal: isTerminal, detail: code }
}

/**
 * Flushes all queued scans serially.
 * Returns { flushed, failed, dropped } counts for the caller to display.
 */
export async function flushQueue(
  client: SupabaseClient,
): Promise<{ flushed: number; failed: number; dropped: number }> {
  const {
    data: { session },
  } = await client.auth.getSession()

  if (!session?.access_token) return { flushed: 0, failed: 0, dropped: 0 }

  const queue = await listQueue()
  let flushed = 0
  let failed = 0
  let dropped = 0

  for (const scan of queue) {
    const result = await postScan(scan, session.access_token)

    if (result.ok) {
      await dequeue(scan.id)
      await appendLog({
        scan_id: scan.id,
        outcome: 'success',
        timestamp: new Date().toISOString(),
      })
      flushed++
      continue
    }

    if (result.terminal) {
      await dequeue(scan.id)
      await appendLog({
        scan_id: scan.id,
        outcome: 'terminal_error',
        timestamp: new Date().toISOString(),
        detail: result.detail,
      })
      dropped++
      continue
    }

    // Retryable — increment attempts.
    await updateAttempt(scan.id, { error: result.detail })
    await appendLog({
      scan_id: scan.id,
      outcome: 'retryable_error',
      timestamp: new Date().toISOString(),
      detail: result.detail,
    })

    if ((scan.attempts + 1) >= MAX_ATTEMPTS) {
      // Leave in queue but surface to user — do not auto-discard.
      failed++
    }
  }

  return { flushed, failed, dropped }
}

/**
 * Retries a single queued scan by its client id.
 * Used for manual retry from the history screen.
 */
export async function flushSingle(
  client: SupabaseClient,
  scanId: string,
): Promise<{ flushed: number; failed: number; dropped: number }> {
  const {
    data: { session },
  } = await client.auth.getSession()

  if (!session?.access_token) return { flushed: 0, failed: 0, dropped: 0 }

  const queue = await listQueue()
  const scan = queue.find((s) => s.id === scanId)
  if (!scan) return { flushed: 0, failed: 0, dropped: 0 }

  const result = await postScan(scan, session.access_token)

  if (result.ok) {
    await dequeue(scan.id)
    await appendLog({ scan_id: scan.id, outcome: 'success', timestamp: new Date().toISOString() })
    return { flushed: 1, failed: 0, dropped: 0 }
  }

  if (result.terminal) {
    await dequeue(scan.id)
    await appendLog({
      scan_id: scan.id,
      outcome: 'terminal_error',
      timestamp: new Date().toISOString(),
      detail: result.detail,
    })
    return { flushed: 0, failed: 0, dropped: 1 }
  }

  await updateAttempt(scan.id, { error: result.detail })
  await appendLog({
    scan_id: scan.id,
    outcome: 'retryable_error',
    timestamp: new Date().toISOString(),
    detail: result.detail,
  })
  return { flushed: 0, failed: 1, dropped: 0 }
}
