// Per-UUID invalid-HMAC rate limiter for /api/scan.
//
// Implements tech-spec §6 (Threat model #1: QR UUID enumeration) and
// api-spec §4.2: 10 invalid HMACs per UUID per rolling 1-hour window
// → that UUID is locked out for 1 hour (subsequent scans return 429).
//
// Why per-UUID and not per-IP:
//   An attacker can rotate IPs cheaply (residential proxy pools, mobile NAT,
//   Tor) but they cannot rotate the QR UUID they are probing — it is the very
//   thing they are trying to discover. Keying on UUID also avoids penalising
//   a real dealer scanning many genuine containers from a shared NAT.
//
// Storage:
//   `public.scan_rate_limits` (see supabase/migrations/0005_rate_limit.sql).
//   Mutations go through the `record_invalid_hmac(uuid)` SQL function so the
//   "increment vs. reset vs. lock" decision is one atomic UPDATE per row —
//   two concurrent invalid scans for the same UUID serialise on the row lock
//   and cannot double-count.
//
// Failure mode:
//   FAIL CLOSED. If the rate-limit table is unreachable (Postgres down, RPC
//   missing, network error) we return `locked: true` with a short retry-after
//   so the scan route returns 503 / 429 instead of waving the request through.
//   The rate limiter is the only gate against UUID-enumeration brute-force;
//   open-failing it would let an attacker turn a database outage into a
//   probing window.
//
// Logging:
//   Only the first 8 chars of the UUID (`uuid_prefix`) are emitted. Full UUIDs
//   are scan-attempt PII proxies — they identify a specific physical container
//   in the field and must not appear in console / error logs.

import type { SupabaseClient } from '@supabase/supabase-js';

export interface RateLimitResult {
  locked: boolean;
  retryAfterSec?: number;
}

// Conservative retry-after returned when the limiter itself is broken. Long
// enough to absorb a transient blip; short enough that a real outage clears
// quickly once the DB recovers.
const FAIL_CLOSED_RETRY_AFTER_SEC = 60;

function uuidPrefix(uuid: string): string {
  return uuid.slice(0, 8);
}

function lockedResult(retryAfterSec: number): RateLimitResult {
  return { locked: true, retryAfterSec };
}

function computeRetryAfterSec(lockedUntilIso: string, nowMs: number): number | null {
  const lockedUntilMs = Date.parse(lockedUntilIso);
  if (Number.isNaN(lockedUntilMs)) return null;
  if (lockedUntilMs <= nowMs) return null;
  return Math.max(1, Math.ceil((lockedUntilMs - nowMs) / 1000));
}

/**
 * Read-only check called BEFORE the HMAC verification on every scan.
 *
 * Returns `{ locked: false }` for the common path so the scan can proceed.
 * Returns `{ locked: true, retryAfterSec }` when the UUID is in a lockout
 * window, or — failing closed — when the limiter table cannot be read.
 */
export async function checkRateLimit(
  uuid: string,
  client: SupabaseClient,
): Promise<RateLimitResult> {
  const { data, error } = await client
    .from('scan_rate_limits')
    .select('locked_until')
    .eq('uuid', uuid)
    .maybeSingle();

  if (error) {
    console.error(
      `[rate-limit] check failed for uuid_prefix=${uuidPrefix(uuid)}: ${error.message}`,
    );
    return lockedResult(FAIL_CLOSED_RETRY_AFTER_SEC);
  }

  const lockedUntil = (data as { locked_until: string | null } | null)?.locked_until ?? null;
  if (lockedUntil === null) return { locked: false };

  const retryAfterSec = computeRetryAfterSec(lockedUntil, Date.now());
  if (retryAfterSec === null) return { locked: false };

  return lockedResult(retryAfterSec);
}

/**
 * Records one invalid HMAC attempt against a UUID.
 *
 * Delegates the window-rollover / increment / lockout decision to the SQL
 * function `record_invalid_hmac(uuid)` so it happens in a single atomic
 * statement (see migration 0005_rate_limit.sql). Returns the post-update
 * lock state for the caller to surface as 429 + Retry-After when appropriate.
 *
 * Fails closed on RPC error.
 */
export async function recordInvalidHmac(
  uuid: string,
  client: SupabaseClient,
): Promise<RateLimitResult> {
  const { data, error } = await client.rpc('record_invalid_hmac', { p_uuid: uuid });

  if (error) {
    console.error(
      `[rate-limit] record failed for uuid_prefix=${uuidPrefix(uuid)}: ${error.message}`,
    );
    return lockedResult(FAIL_CLOSED_RETRY_AFTER_SEC);
  }

  // The function returns RETURNS TABLE (locked boolean, retry_after_sec int);
  // supabase-js surfaces that as an array of one row.
  const row = (Array.isArray(data) ? data[0] : data) as
    | { locked: boolean; retry_after_sec: number | null }
    | null
    | undefined;

  if (!row || row.locked !== true) return { locked: false };

  const retryAfterSec =
    typeof row.retry_after_sec === 'number' && row.retry_after_sec > 0
      ? row.retry_after_sec
      : FAIL_CLOSED_RETRY_AFTER_SEC;

  return lockedResult(retryAfterSec);
}

/**
 * Optional cleanup invoked AFTER a successful scan: drops the rate-limit row
 * for that UUID so the counter does not linger and accidentally lock the next
 * legitimate scan if it happens to fall in a stale window.
 *
 * Best-effort: any DB error is logged (with prefix only) and swallowed —
 * a failed cleanup must not turn a successful scan into a failed one.
 */
export async function resetRateLimit(
  uuid: string,
  client: SupabaseClient,
): Promise<void> {
  const { error } = await client.from('scan_rate_limits').delete().eq('uuid', uuid);
  if (error) {
    console.error(
      `[rate-limit] reset failed for uuid_prefix=${uuidPrefix(uuid)}: ${error.message}`,
    );
  }
}
