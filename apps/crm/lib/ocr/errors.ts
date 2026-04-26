// Shared error classification + masking utilities for the OCR adapters.
//
// Both provider adapters (Gemini, Claude) catch heterogeneous SDK errors and
// translate them into a single `OcrErrorEnvelope` shape so the orchestrator
// in `./index.ts` can make uniform retry / fallback decisions.

import type { AdapterError, OcrFieldResult, OcrResult } from '@gaia/shared/adapters';

import type { OcrModelResponse } from './prompt.js';

export type OcrProviderName = 'gemini' | 'claude';

/**
 * Adapter error envelope augmented with OCR-specific fields used by the
 * orchestrator. Structurally compatible with `AdapterError`.
 */
export type OcrErrorEnvelope = AdapterError & {
  provider?: OcrProviderName | undefined;
  retryable?: boolean | undefined;
  httpStatus?: number | undefined;
  /** Stable code for callers; populated as 'OCR_UNAVAILABLE' when both providers fail. */
  code?: string | undefined;
};

/** Mask an API key inside any string — keeps last 4 characters. */
export function maskKey(text: string, apiKey: string | undefined): string {
  if (!apiKey || apiKey.length < 8) return text;
  const tail = apiKey.slice(-4);
  const masked = `***${tail}`;
  // Replace globally; escape regex metacharacters in the key.
  const escaped = apiKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text.replace(new RegExp(escaped, 'g'), masked);
}

function readNumber(obj: unknown, key: string): number | undefined {
  if (obj && typeof obj === 'object' && key in obj) {
    const v = (obj as Record<string, unknown>)[key];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
  }
  return undefined;
}

function readString(obj: unknown, key: string): string | undefined {
  if (obj && typeof obj === 'object' && key in obj) {
    const v = (obj as Record<string, unknown>)[key];
    if (typeof v === 'string') return v;
  }
  return undefined;
}

/**
 * Best-effort extraction of an HTTP status code from an unknown SDK error.
 * Anthropic SDK exposes `.status`; Google generative-ai often surfaces the
 * code via `.status` / `.statusCode` or by embedding it in the message.
 */
function extractHttpStatus(err: unknown): number | undefined {
  if (typeof err !== 'object' || err === null) return undefined;
  return (
    readNumber(err, 'status') ??
    readNumber(err, 'statusCode') ??
    (() => {
      const msg = readString(err, 'message') ?? '';
      const m = /\b(4\d\d|5\d\d)\b/.exec(msg);
      return m && m[1] ? Number(m[1]) : undefined;
    })()
  );
}

function isAbortError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const name = readString(err, 'name');
  if (name === 'AbortError') return true;
  const msg = readString(err, 'message') ?? '';
  return /aborted|timeout/i.test(msg) && /signal|abort/i.test(msg);
}

/**
 * Translate a thrown SDK error into a normalised OcrErrorEnvelope.
 * Marks `retryable: true` for timeouts and 5xx responses only.
 */
export function classifyProviderError(
  provider: OcrProviderName,
  err: unknown,
  apiKey: string | undefined,
): OcrErrorEnvelope {
  const rawMessage =
    (typeof err === 'object' && err !== null && readString(err, 'message')) ||
    String(err);
  const message = maskKey(rawMessage, apiKey);

  if (isAbortError(err)) {
    return {
      kind: 'timeout',
      adapter: 'ocr',
      message: `${provider}: request timed out`,
      provider,
      retryable: true,
    };
  }

  const httpStatus = extractHttpStatus(err);

  if (httpStatus !== undefined) {
    if (httpStatus === 429) {
      return {
        kind: 'rate_limited',
        adapter: 'ocr',
        message,
        provider,
        httpStatus,
        retryable: false,
      };
    }
    if (httpStatus === 401 || httpStatus === 403) {
      return {
        kind: 'unauthorized',
        adapter: 'ocr',
        message,
        provider,
        httpStatus,
        retryable: false,
      };
    }
    if (httpStatus >= 500) {
      return {
        kind: 'provider',
        adapter: 'ocr',
        message,
        provider,
        httpStatus,
        retryable: true,
      };
    }
    // 4xx other than the above
    return {
      kind: 'provider',
      adapter: 'ocr',
      message,
      provider,
      httpStatus,
      retryable: false,
    };
  }

  // Bare network failures (DNS, ECONNRESET, fetch type-errors).
  if (
    typeof err === 'object' &&
    err !== null &&
    (readString(err, 'name') === 'TypeError' ||
      /network|fetch failed|ECONN|EAI_AGAIN/i.test(rawMessage))
  ) {
    return {
      kind: 'network',
      adapter: 'ocr',
      message,
      provider,
      retryable: true,
    };
  }

  return {
    kind: 'provider',
    adapter: 'ocr',
    message,
    provider,
    retryable: false,
  };
}

export function validationError(
  provider: OcrProviderName,
  reason: 'not_json' | 'schema_mismatch',
): OcrErrorEnvelope {
  return {
    kind: 'validation',
    adapter: 'ocr',
    message: `${provider}: model output failed validation (${reason})`,
    provider,
    retryable: false,
  };
}

/**
 * Convert the strict model response (which preserves null + arrays) to the
 * shared `OcrResult` shape (string-only `value`). Arrays are joined with
 * '; '; nulls become '' so the OcrFieldResult contract holds.
 */
export function toLegacyOcrResult(parsed: OcrModelResponse): OcrResult {
  const fields: Record<string, OcrFieldResult> = {};
  for (const [key, entry] of Object.entries(parsed.fields)) {
    let value: string;
    if (entry.value === null) value = '';
    else if (Array.isArray(entry.value)) value = entry.value.join('; ');
    else value = entry.value;
    fields[key] = { value, confidence: entry.confidence };
  }
  return { fields, rawText: parsed.raw_text };
}

/** Aggregate stats for log lines — never includes field values. */
export function fieldStats(fields: Readonly<Record<string, OcrFieldResult>>): {
  fieldCount: number;
  avgConfidence: number;
} {
  const entries = Object.values(fields);
  const filled = entries.filter((e) => e.value !== '');
  const avg =
    entries.length === 0
      ? 0
      : entries.reduce((sum, e) => sum + e.confidence, 0) / entries.length;
  return {
    fieldCount: filled.length,
    avgConfidence: Math.round(avg * 1000) / 1000,
  };
}
