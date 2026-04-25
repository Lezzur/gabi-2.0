// HMAC-SHA256 utilities for QR URL suffix verification.
//
// See tech-spec §6 (Security Considerations — Threat model item #4: Counterfeit
// QR forgery). Containers are addressed by `<uuid>.<16-hex>` where the suffix
// is the first 16 hex chars of HMAC-SHA256(server-held secret, uuid). Requests
// presenting a UUID without a valid HMAC are rejected with 401, and an
// in-memory rate-limit locks a UUID after 10 invalid attempts/hour.
//
// Comparison is constant-time via `crypto.timingSafeEqual`. The HMAC value is
// never logged on verification failure — only `{ uuid, hmac_valid: false }`.

import { createHmac, timingSafeEqual } from 'node:crypto';

const UUID_V4_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HMAC16_REGEX = /^[0-9a-f]{16}$/;

export class EnvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EnvError';
  }
}

export function getHmacSecret(): string {
  const secret = process.env.HMAC_SECRET;
  if (!secret || secret.length === 0) {
    throw new EnvError(
      'HMAC_SECRET environment variable is required but not set. ' +
        'See apps/crm/.env.example and tech-spec §6 (Secrets management).',
    );
  }
  return secret;
}

export function computeHmac16(uuid: string, secret: string): string {
  return createHmac('sha256', secret).update(uuid).digest('hex').slice(0, 16);
}

export function verifyHmac16(
  uuid: string,
  providedHmac: string,
  secret: string,
): boolean {
  const expected = computeHmac16(uuid, secret);

  // A wrong-length input is a guaranteed failure, so short-circuiting here
  // does not leak useful timing — we'd reject it after timingSafeEqual anyway,
  // and timingSafeEqual itself throws on mismatched buffer lengths.
  if (providedHmac.length !== expected.length) return false;

  const expectedBuf = Buffer.from(expected, 'hex');
  const providedBuf = Buffer.from(providedHmac, 'hex');

  // `Buffer.from(_, 'hex')` silently truncates on the first non-hex character;
  // if the input was malformed the decoded length will differ from expected.
  if (providedBuf.length !== expectedBuf.length) return false;

  return timingSafeEqual(providedBuf, expectedBuf);
}

export function parseScanSuffix(
  path: string,
): { uuid: string; hmac: string } | null {
  if (typeof path !== 'string' || path.length === 0) return null;

  const lastSlash = path.lastIndexOf('/');
  const segment = lastSlash >= 0 ? path.slice(lastSlash + 1) : path;

  const dotIndex = segment.indexOf('.');
  if (dotIndex <= 0 || dotIndex !== segment.lastIndexOf('.')) return null;

  const uuid = segment.slice(0, dotIndex);
  const hmac = segment.slice(dotIndex + 1);

  if (!UUID_V4_REGEX.test(uuid)) return null;
  if (!HMAC16_REGEX.test(hmac)) return null;

  return { uuid, hmac };
}
