import { z } from 'zod';

// Per api-spec §6.1 / tech-spec §4.4 — every field is normalized to lowercase
// snake_case here. The schema runs in `strict()` mode so unknown fields are
// rejected outright; this stops attackers from smuggling extra columns through
// the route handler.

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HMAC16_RE = /^[0-9a-f]{16}$/;
const E164_RE = /^\+[1-9]\d{1,14}$/;

const SCAN_STEPS = ['purchase_dealer', 'purchase_farmer', 'return_dealer', 'return_farmer'] as const;
const ACTOR_TYPES = ['farmer', 'dealer', 'admin'] as const;

const uuidV4 = z.string().regex(UUID_V4_RE, 'invalid_uuid');
const hmac16 = z.string().regex(HMAC16_RE, 'invalid_hmac');
const isoTs = z.string().datetime({ offset: true, message: 'invalid_timestamp' });
const e164 = z.string().regex(E164_RE, 'invalid_phone');

export const ScanRequestSchema = z
  .object({
    uuid: uuidV4,
    hmac: hmac16,
    step: z.enum(SCAN_STEPS),
    actor_type: z.enum(ACTOR_TYPES),
    local_scan_ts: isoTs.optional(),
    last_online_ts: isoTs.optional(),
    client_device_id: z.string().min(1).max(128).optional(),
    idempotency_key: uuidV4.optional(),
    condition_confirmed: z.boolean().optional(),
    farmer_phone: e164.optional(),
  })
  .strict();

export type ScanRequestInput = z.infer<typeof ScanRequestSchema>;

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export type ClockBoundsResult =
  | { ok: true }
  | { ok: false; code: 'CLOCK_SKEW' | 'FUTURE_TIMESTAMP' | 'STALE_OFFLINE' };

// SECURITY: a user with a skewed device clock cannot bypass purchase-expiry or
// return-window windows — every comparison is anchored to `serverNow`, never
// to another client-supplied timestamp on its own. last_online_ts is itself
// untrusted, so we only use it as a lower-bound monotonicity check (rejecting
// rollback) and combine that with the absolute server upper bound (7 days).
export function validateClockBounds(
  local_scan_ts: string,
  last_online_ts: string | null,
  serverNow: Date,
): ClockBoundsResult {
  const localMs = Date.parse(local_scan_ts);
  if (Number.isNaN(localMs)) return { ok: false, code: 'CLOCK_SKEW' };

  const nowMs = serverNow.getTime();

  if (localMs > nowMs) return { ok: false, code: 'FUTURE_TIMESTAMP' };

  if (last_online_ts !== null) {
    const lastOnlineMs = Date.parse(last_online_ts);
    if (Number.isNaN(lastOnlineMs)) return { ok: false, code: 'CLOCK_SKEW' };
    if (localMs < lastOnlineMs) return { ok: false, code: 'CLOCK_SKEW' };
  }

  if (nowMs - localMs > SEVEN_DAYS_MS) return { ok: false, code: 'STALE_OFFLINE' };

  return { ok: true };
}

export function validateIdempotencyKey(key: string | null): boolean {
  if (key === null) return true;
  return UUID_V4_RE.test(key);
}

export type ScanRequestParseResult =
  | { ok: true; data: ScanRequestInput }
  | { ok: false; code: 'INVALID_INPUT'; field: string | null; message: string };

// Map Zod failures to the api-spec INVALID_INPUT envelope. We surface only the
// first field path and a stable i18n key — never the raw Zod issue list — so
// schema internals (issue codes, expected types, internal regex names) never
// leak to the client.
export function parseScanRequest(input: unknown): ScanRequestParseResult {
  const result = ScanRequestSchema.safeParse(input);
  if (result.success) return { ok: true, data: result.data };

  const issue = result.error.issues[0];
  const field = issue && issue.path.length > 0 ? issue.path.join('.') : null;
  return {
    ok: false,
    code: 'INVALID_INPUT',
    field,
    message: 'i18n:errors.invalid_input',
  };
}
