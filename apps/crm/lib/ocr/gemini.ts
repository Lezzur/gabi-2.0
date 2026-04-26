// Gemini 1.5 Pro OCR adapter.
//
// Implements the shared OcrAdapter interface backed by `@google/generative-ai`.
// Per-call hardening (timeout, classification of errors into AdapterError
// kinds, schema validation, API-key masking) lives here; retry / fallback
// orchestration lives in `./index.ts`.

import { GoogleGenerativeAI } from '@google/generative-ai';

import type { OcrAdapter, OcrResult, Result } from '@gaia/shared/adapters';

import {
  OCR_SYSTEM_PROMPT,
  fetchImageForOcr,
  parseModelOutput,
} from './prompt.js';
import type { OcrErrorEnvelope } from './errors.js';
import {
  classifyProviderError,
  fieldStats,
  maskKey,
  toLegacyOcrResult,
  validationError,
} from './errors.js';

const DEFAULT_MODEL = 'gemini-1.5-pro-latest';
const TIMEOUT_MS = 30_000;

export type GeminiAdapterOptions = {
  apiKey?: string | undefined;
  model?: string | undefined;
  timeoutMs?: number | undefined;
};

export function createGeminiAdapter(
  options: GeminiAdapterOptions = {},
): OcrAdapter & { providerName: 'gemini' } {
  const apiKey = options.apiKey ?? process.env['GEMINI_API_KEY'] ?? '';
  const modelName = options.model ?? DEFAULT_MODEL;
  const timeoutMs = options.timeoutMs ?? TIMEOUT_MS;

  return {
    providerName: 'gemini',

    async extractLabel(
      imageUrl: string,
      _lang?: string,
    ): Promise<Result<OcrResult, OcrErrorEnvelope>> {
      const started = Date.now();

      if (!apiKey) {
        return {
          ok: false,
          error: {
            kind: 'unauthorized',
            adapter: 'ocr',
            message: 'gemini api key not configured',
            provider: 'gemini',
            retryable: false,
          },
        };
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const image = await fetchImageForOcr(imageUrl, controller.signal);

        const client = new GoogleGenerativeAI(apiKey);
        const model = client.getGenerativeModel({
          model: modelName,
          generationConfig: {
            temperature: 0,
            responseMimeType: 'application/json',
          },
        });

        const response = await model.generateContent(
          {
            contents: [
              {
                role: 'user',
                parts: [
                  { text: OCR_SYSTEM_PROMPT },
                  {
                    inlineData: {
                      mimeType: image.mimeType,
                      data: image.buffer.toString('base64'),
                    },
                  },
                ],
              },
            ],
          },
          { signal: controller.signal },
        );

        const text = response.response.text();
        const parsed = parseModelOutput(text);
        if (!parsed.ok) {
          return {
            ok: false,
            error: validationError('gemini', parsed.reason),
          };
        }

        const legacy = toLegacyOcrResult(parsed.value);
        const stats = fieldStats(legacy.fields);
        // Never log raw model output or image content.
        // eslint-disable-next-line no-console
        console.info('[ocr] success', {
          provider: 'gemini',
          duration_ms: Date.now() - started,
          field_count: stats.fieldCount,
          avg_confidence: stats.avgConfidence,
        });

        return { ok: true, value: legacy };
      } catch (err) {
        const error = classifyProviderError('gemini', err, apiKey);
        // eslint-disable-next-line no-console
        console.warn('[ocr] failure', {
          provider: 'gemini',
          duration_ms: Date.now() - started,
          kind: error.kind,
          retryable: error.retryable === true,
          message: maskKey(error.message, apiKey),
        });
        return { ok: false, error };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

