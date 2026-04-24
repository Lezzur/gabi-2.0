/**
 * SMS adapter interface.
 *
 * Concrete implementations live in the CRM app (`apps/crm`):
 *   - `TwilioSmsAdapter`    — Twilio Programmable Messaging (international)
 *   - `SemaphoreSmsAdapter` — Semaphore.ph (Philippine MSISDN, lower cost)
 *
 * Consumers depend on this interface only; the CRM wires the concrete adapter
 * via dependency injection so the mobile app and website stay provider-agnostic.
 */

import type { AdapterError, Result } from "./types.js";

export interface SmsAdapter {
  /**
   * Send a one-time password via SMS.
   *
   * @param phone         - E.164 phone number (e.g. `+639171234567`).
   * @param code          - The OTP string to deliver.
   * @param idempotencyKey - Caller-supplied key that guarantees exactly-once
   *   delivery.  Use a UUIDv4 or a deterministic hash of `(phone, code, ts)`.
   *   Providers MUST reject duplicate keys within a provider-defined window
   *   (Twilio: 4 h, Semaphore: 1 h).
   *
   * @timeout 5 seconds — callers must set a client-side deadline; the adapter
   *   implementation must not block longer than this before returning an error.
   *
   * @retry Exactly-once.  Do NOT retry with the same `idempotencyKey`; generate
   *   a fresh key for each new attempt and handle downstream deduplication.
   */
  sendOtp(
    phone: string,
    code: string,
    idempotencyKey: string,
  ): Promise<Result<void, AdapterError>>;

  /**
   * Send a templated notification SMS.
   *
   * @param phone      - E.164 phone number.
   * @param messageKey - i18n key identifying the message template
   *   (e.g. `"scan.reward_credited"`).  The implementation resolves the
   *   template from the active locale.
   * @param params     - Named interpolation values for the template.
   *
   * @timeout 5 seconds
   *
   * @retry Exactly-once.  Notification SMS are fire-and-forget from the
   *   scan pipeline's perspective; a failed send must not block the scan
   *   response.  Log the error and surface it via the adapter result rather
   *   than throwing.
   */
  sendNotification(
    phone: string,
    messageKey: string,
    params: Readonly<Record<string, string>>,
  ): Promise<Result<void, AdapterError>>;
}
