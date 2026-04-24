/**
 * Shared primitives for all service adapters.
 *
 * `Result<T, E>` is a discriminated union used as the return type of every
 * adapter method — no raw `Error` escapes the adapter boundary.
 *
 * `AdapterError` is the canonical error shape.  The `adapter` field lets
 * callers narrow errors by origin without instanceof checks.
 */

export type Result<T, E> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; error: E }>;

export type AdapterErrorKind =
  | "timeout"
  | "network"
  | "provider"
  | "validation"
  | "rate_limited"
  | "not_found"
  | "unauthorized";

export type AdapterError = Readonly<{
  kind: AdapterErrorKind;
  /** Which adapter produced this error. */
  adapter: "sms" | "ocr" | "storage";
  message: string;
  /** Original thrown value, if available. */
  cause?: unknown;
}>;
