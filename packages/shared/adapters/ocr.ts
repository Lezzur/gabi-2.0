/**
 * OCR adapter interface for agricultural product label extraction.
 *
 * Provider strategy (Component E in the tech spec):
 *   1. **Primary**  — Gemini 1.5 Pro (`OCR_PROVIDER=gemini`).
 *   2. **Fallback** — Claude 3.5 Sonnet (`OCR_PROVIDER=claude`), activated
 *      automatically when the primary returns a non-retryable provider error
 *      OR when any field's `confidence` score falls below a threshold defined
 *      by the implementation (recommended: 0.75).
 *
 * The adapter is concurrency-limited to 5 simultaneous calls (semaphore)
 * to avoid upstream rate-limit errors.
 *
 * The concrete implementation lives in `apps/crm` (or a shared server
 * package).  This interface is provider-agnostic.
 */

import type { AdapterError, Result } from "./types.js";

/** Extraction result for a single label field. */
export type OcrFieldResult = Readonly<{
  /** Extracted text value; empty string if the field was not found. */
  value: string;
  /** Provider confidence score in the range [0.0, 1.0]. */
  confidence: number;
}>;

/**
 * Structured extraction result for an agricultural product label.
 *
 * `fields` is keyed by the 14 canonical label field names defined in the
 * Zod schema at `packages/shared/schemas/ocr.ts` (e.g. `"product_name"`,
 * `"active_ingredient"`, `"registration_number"`, …).
 *
 * `rawText` preserves the full OCR transcript for audit logging and
 * debugging; it is not used by the scan pipeline directly.
 */
export type OcrResult = Readonly<{
  fields: Readonly<Record<string, OcrFieldResult>>;
  rawText: string;
}>;

export interface OcrAdapter {
  /**
   * Extract structured label data from an agricultural product image.
   *
   * Primary provider: Gemini 1.5 Pro.
   * Fallback provider: Claude 3.5 Sonnet — see module-level documentation
   * for the activation conditions.
   *
   * @param imageUrl - Publicly accessible URL or signed Supabase/R2 URL of
   *   the label image.  The URL must remain valid for the full call duration.
   * @param lang     - BCP 47 language tag for OCR language hints.  Defaults to
   *   `"en"` when omitted.  Pass `"tl"` for Tagalog-heavy labels.
   *
   * @timeout 30 seconds — label images can be large; the implementation must
   *   enforce this deadline on both the primary and fallback calls individually.
   *   A timeout surfaces as `AdapterError` with `kind: "timeout"`.
   *
   * @retry Pure / idempotent — the same `(imageUrl, lang)` pair always
   *   produces equivalent output.  Safe to retry on transient errors without
   *   side effects.
   */
  extractLabel(
    imageUrl: string,
    lang?: string,
  ): Promise<Result<OcrResult, AdapterError>>;
}
