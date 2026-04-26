// Idempotency-key store for /api/scan (offline-replay safety).
//
// Implements the dedup gate from tech-spec §5.2 (mobile queues a scan
// while offline and the request is replayed minutes-to-hours later) and
// api-spec §6.1 (a 200 response lost in transit must not double-execute
// the state machine on retry). The client picks one v4 UUID per queued
// scan and resends it on every retry; the server caches the rendered
// response body for 24 h (see supabase/migrations/0007_idempotency.sql)
// and the next replay returns those exact bytes instead of re-running
// the wallet credit / state transition.
//
// User scoping:
//   Every read and write is filtered by (key, user_id). Even though the
//   underlying table has `key` as a sole PRIMARY KEY (a v4-UUID
//   collision across users is vanishingly unlikely), checkIdempotency()
//   ALSO requires user_id to match. That makes the conceptual uniqueness
//   tuple (key, user_id) at the application boundary: user B asking for
//   user A's key returns null (cache miss) and proceeds to a fresh scan
//   — never serves user A's cached response under user B's session.
//
// Failure mode:
//   FAIL CLOSED. Every DB error is rethrown so the scan route can return
//   503 instead of silently degrading to non-idempotent mode. Rationale:
//   the wallet-credit path is non-reversible. If the idempotency table
//   is unreachable and we executed the scan anyway, a subsequent retry
//   would re-execute and double-credit. Surfacing 503 means the mobile
//   client keeps the scan queued and re-tries when the DB recovers, at
//   which point the cache hit returns the original outcome.
//
//   This includes the unique-constraint case: storeIdempotency() throws
//   on a duplicate-key INSERT (rare — would mean two concurrent requests
//   raced past checkIdempotency()). The route handler should treat that
//   like any other storage failure and return 503; the wallet-credit
//   path's atomic UPDATE … WHERE state = <expected> remains the
//   load-bearing defence against double-credit on the racing call.
//
// Logging:
//   Only the first 8 chars of the key are emitted (`key_prefix`). A full
//   idempotency key is a 24-h capability token — anyone holding it can
//   replay the matching scan response — so it must not appear in
//   console / error logs.

import type { SupabaseClient } from '@supabase/supabase-js';

function keyPrefix(key: string): string {
  return key.slice(0, 8);
}

/**
 * Returns the cached response body for (key, user_id), or null if no
 * matching row exists or the row has expired.
 *
 * Throws on any DB error so the caller can surface 503.
 *
 * The returned value is whatever was passed to storeIdempotency() —
 * supabase-js round-trips jsonb as parsed JSON, so the structure is
 * byte-for-byte equivalent to the original response (including original
 * timestamp strings like `pending_expires_at`).
 */
export async function checkIdempotency(
  key: string,
  userId: string,
  client: SupabaseClient,
): Promise<unknown | null> {
  const { data, error } = await client
    .from('scan_idempotency')
    .select('response_body, expires_at, user_id')
    .eq('key', key)
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    throw new Error(
      `[idempotency] check failed for key_prefix=${keyPrefix(key)}: ${error.message}`,
      { cause: error },
    );
  }

  if (!data) return null;

  // Defence in depth: PostgREST already filtered by user_id, but a row
  // whose user_id doesn't match should never be returned regardless.
  // A mismatch here would indicate a query-builder bug or a future
  // schema change; reject as miss rather than leak another user's data.
  const row = data as { response_body: unknown; expires_at: string; user_id: string };
  if (row.user_id !== userId) return null;

  // The cleanup job stub (migration 0007) is not yet running in dev.
  // Treat an expired row as a miss so we never serve a response past
  // the 24-h TTL operators have authorised it to live for.
  const expiresAtMs = Date.parse(row.expires_at);
  if (Number.isFinite(expiresAtMs) && expiresAtMs <= Date.now()) {
    return null;
  }

  return row.response_body;
}

/**
 * Inserts the rendered response body under (key, user_id) so a future
 * retry within 24 h returns the same bytes via checkIdempotency().
 *
 * `response` is stored as jsonb — must be a JSON-serialisable plain
 * object / array / scalar. Pass the response *body* the route is about
 * to send (not the NextResponse instance) so timestamp fields, request
 * IDs, and computed messages are preserved verbatim.
 *
 * Throws on any DB error including unique-constraint violations. Caller
 * surfaces 503 — never silently degrades to non-idempotent mode.
 */
export async function storeIdempotency(
  key: string,
  userId: string,
  response: unknown,
  client: SupabaseClient,
): Promise<void> {
  const { error } = await client.from('scan_idempotency').insert({
    key,
    user_id: userId,
    response_body: response as never,
  });

  if (error) {
    throw new Error(
      `[idempotency] store failed for key_prefix=${keyPrefix(key)}: ${error.message}`,
      { cause: error },
    );
  }
}
