// OCR adapter factory + provider fallback orchestrator.
//
// `createOcrAdapter()` selects a primary provider based on `OCR_PROVIDER`
// (default 'gemini') and wraps it with:
//   1. Per-call timeout enforced inside each provider (30s).
//   2. Single retry on the primary for retryable failures (5xx / timeout).
//   3. Fallback to the secondary provider on any non-success terminal result.
//   4. Single retry on the secondary for retryable failures.
//   5. If both providers fail, return an OcrErrorEnvelope with
//      code: 'OCR_UNAVAILABLE'. Never synthesise a fake extraction.
//
// The wrapped adapter conforms to `@gaia/shared/adapters#OcrAdapter`.

import type { OcrAdapter, OcrResult, Result } from '@gaia/shared/adapters';

import { createClaudeAdapter } from './claude.js';
import { createGeminiAdapter } from './gemini.js';

import type { OcrErrorEnvelope, OcrProviderName } from './errors.js';

export type { OcrErrorEnvelope, OcrProviderName } from './errors.js';
export { createClaudeAdapter } from './claude.js';
export { createGeminiAdapter } from './gemini.js';
export {
  ALL_FIELD_KEYS,
  ARRAY_FIELD_KEYS,
  SCALAR_FIELD_KEYS,
  OCR_SYSTEM_PROMPT,
  OcrModelResponseSchema,
} from './prompt.js';
export type {
  ArrayFieldKey,
  FieldKey,
  OcrModelResponse,
  ScalarFieldKey,
} from './prompt.js';

type ProviderAdapter = OcrAdapter & { providerName: OcrProviderName };

export type CreateOcrAdapterOptions = {
  /** Override OCR_PROVIDER env. */
  provider?: OcrProviderName | undefined;
  geminiApiKey?: string | undefined;
  anthropicApiKey?: string | undefined;
  /** Disable fallback when only one provider is desired (default true). */
  fallback?: boolean | undefined;
};

function resolveProvider(
  explicit: OcrProviderName | undefined,
): OcrProviderName {
  if (explicit) return explicit;
  const env = (process.env['OCR_PROVIDER'] ?? '').toLowerCase().trim();
  if (env === 'claude') return 'claude';
  return 'gemini';
}

function isRetryable(err: OcrErrorEnvelope): boolean {
  return err.retryable === true;
}

async function callOnceWithRetry(
  provider: ProviderAdapter,
  imageUrl: string,
  lang: string | undefined,
): Promise<Result<OcrResult, OcrErrorEnvelope>> {
  const first = (await provider.extractLabel(imageUrl, lang)) as Result<
    OcrResult,
    OcrErrorEnvelope
  >;
  if (first.ok) return first;
  if (!isRetryable(first.error)) return first;
  // Retry once on retryable errors (5xx / timeout).
  return (await provider.extractLabel(imageUrl, lang)) as Result<
    OcrResult,
    OcrErrorEnvelope
  >;
}

/**
 * Build an OCR adapter that conforms to the shared `OcrAdapter` interface
 * and applies the fallback / retry policy described above.
 */
export function createOcrAdapter(
  options: CreateOcrAdapterOptions = {},
): OcrAdapter {
  const primaryName = resolveProvider(options.provider);
  const fallbackName: OcrProviderName =
    primaryName === 'gemini' ? 'claude' : 'gemini';
  const fallbackEnabled = options.fallback !== false;

  const make = (name: OcrProviderName): ProviderAdapter =>
    name === 'gemini'
      ? createGeminiAdapter(
          options.geminiApiKey !== undefined
            ? { apiKey: options.geminiApiKey }
            : {},
        )
      : createClaudeAdapter(
          options.anthropicApiKey !== undefined
            ? { apiKey: options.anthropicApiKey }
            : {},
        );

  const primary = make(primaryName);
  const fallback = fallbackEnabled ? make(fallbackName) : null;

  return {
    async extractLabel(
      imageUrl: string,
      lang?: string,
    ): Promise<Result<OcrResult, OcrErrorEnvelope>> {
      const primaryResult = await callOnceWithRetry(primary, imageUrl, lang);
      if (primaryResult.ok) return primaryResult;

      if (!fallback) {
        return {
          ok: false,
          error: unavailable(primaryResult.error),
        };
      }

      const fallbackResult = await callOnceWithRetry(fallback, imageUrl, lang);
      if (fallbackResult.ok) return fallbackResult;

      return {
        ok: false,
        error: unavailable(primaryResult.error, fallbackResult.error),
      };
    },
  };
}

function unavailable(
  primary: OcrErrorEnvelope,
  fallback?: OcrErrorEnvelope,
): OcrErrorEnvelope {
  const parts: string[] = [
    `primary(${primary.provider ?? '?'}: ${primary.kind})`,
  ];
  if (fallback) {
    parts.push(`fallback(${fallback.provider ?? '?'}: ${fallback.kind})`);
  }
  return {
    kind: 'provider',
    adapter: 'ocr',
    code: 'OCR_UNAVAILABLE',
    message: `OCR_UNAVAILABLE — ${parts.join(', ')}`,
    retryable: false,
    cause: fallback ? { primary, fallback } : { primary },
  };
}
