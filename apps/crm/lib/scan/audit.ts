// Forensic audit writer for scan_attempts (append-only table).
//
// Callers: scan route for rejections (awaited inline), and the state-change
// transaction for successes (see p3-scan-route). This function always throws
// on DB failure — caller decides whether to surface or swallow.
//
// PII policy: phone numbers are never passed in or stored. actor_user_id is an
// anonymous UUID foreign key. client_ip is hashed before storage (see hashIp).
//
// SECURITY: always use the service-role client — RLS allows INSERT only, so the
// anon/authed clients can write, but only the service role can bypass the
// append-only enforcement without being rejected by the mutation trigger.

import { createHmac } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@gaia/supabase';
import type { ActorType, ScanStep, ScanOutcome } from '@gaia/shared/types';

export interface ScanAuditInput {
  /** Container UUID from the QR payload. Stored as container_id only when HMAC is valid. */
  uuid: string;
  actor_type: ActorType | null;
  /** Authenticated user UUID → actor_id. Never a phone number. */
  actor_user_id?: string | null;
  step: ScanStep;
  outcome: ScanOutcome;
  /**
   * Application-level diagnostic code (e.g. 'HMAC_MISMATCH', 'SESSION_EXPIRED').
   * Not stored in scan_attempts — no column. Useful for server-side logging by the caller.
   */
  failure_code?: string;
  /** Raw client IP — hashed via hashIp() before any storage. */
  client_ip?: string | null;
  /**
   * User-Agent header. Not stored — scan_attempts has no user_agent column.
   * Accepted here so callers don't need to branch on the presence of the column.
   */
  user_agent?: string | null;
  /** Device-claimed scan timestamp (ISO 8601 with offset). */
  local_scan_ts?: string | null;
}

/**
 * Derives hmac_valid and auth_valid from the scan outcome.
 *
 * - hmac_invalid  → HMAC check failed before identity could be established.
 * - auth_required → HMAC was valid; session was absent or expired.
 * - all others    → both checks passed (rejection was business-logic, not auth).
 */
function deriveValidFlags(outcome: ScanOutcome): { hmac_valid: boolean; auth_valid: boolean } {
  if (outcome === 'hmac_invalid') return { hmac_valid: false, auth_valid: false };
  if (outcome === 'auth_required') return { hmac_valid: true, auth_valid: false };
  return { hmac_valid: true, auth_valid: true };
}

/**
 * Hashes a client IP address with a weekly-rotating HMAC key so raw addresses
 * are never persisted. The key is supplied via `IP_HASH_KEY_WEEK` (stub — rotate
 * this Vercel env var weekly; rolling correlation windows are bounded to 7 days).
 *
 * MIGRATION NOTE: scan_attempts.ip_address is currently `inet` in Postgres, which
 * rejects non-address strings. Persisting the hash requires a migration that changes
 * the column to `text` (or adds a separate `ip_address_hash text` column). Export is
 * intentional — wire into recordScanAttempt once that migration is applied.
 */
export function hashIp(ip: string): string {
  const key = process.env['IP_HASH_KEY_WEEK'] ?? '';
  return createHmac('sha256', key).update(ip).digest('hex');
}

/**
 * Inserts one row into scan_attempts for every scan attempt, success or failure.
 *
 * Blocking behaviour:
 *   - Rejection outcomes: caller awaits this before sending the HTTP response
 *     (forensic record must land before we tell the client it failed).
 *   - Success outcomes: called inside the state-change DB transaction so the
 *     audit row commits atomically with the container state update; the scan
 *     response is not held waiting for a separate write.
 *
 * Throws on DB error — never silently swallows. Caller decides to surface or drop.
 */
export async function recordScanAttempt(
  input: ScanAuditInput,
  client: SupabaseClient<Database>,
): Promise<void> {
  const { uuid, actor_type, actor_user_id, step, outcome, client_ip, local_scan_ts } = input;

  const { hmac_valid, auth_valid } = deriveValidFlags(outcome);

  // When HMAC validation fails the UUID in the QR payload is untrusted — do not
  // link it to an actual container row.
  const container_id = outcome === 'hmac_invalid' ? null : uuid;

  // ip_address is stored as null: the hash is computed (hashIp) but the column is
  // inet in Postgres and cannot accept an HMAC hex string. Wire hashIp() here and
  // replace null with ip_hash once the column is migrated to text.
  void client_ip; // received — discarded until migration; raw IP never written

  // NOTE: if outcome is 'rate_limited' it is absent from the DB scan_outcome enum
  // (the hand-written types placeholder is missing it). Postgres will reject the
  // insert and this function will throw; the caller should decide whether to swallow.
  const { error } = await client.from('scan_attempts').insert({
    container_id,
    actor_id: actor_user_id ?? null,
    actor_type: (actor_type ?? null) as Database['public']['Enums']['actor_type'] | null,
    step: step as Database['public']['Enums']['scan_step'],
    outcome: outcome as Database['public']['Enums']['scan_outcome'],
    hmac_valid,
    auth_valid,
    ip_address: null,
    local_scan_ts: local_scan_ts ?? null,
  });

  if (error) {
    throw new Error(`[audit] scan_attempts insert failed: ${error.message}`, { cause: error });
  }
}
