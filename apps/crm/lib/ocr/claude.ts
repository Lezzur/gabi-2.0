// Claude 3.5 Sonnet OCR adapter.
//
// Implements the shared OcrAdapter interface backed by `@anthropic-ai/sdk`.
// Per-call hardening (timeout, classification of errors into AdapterError
// kinds, schema validation, API-key masking) lives here; retry / fallback
// orchestration lives in `./index.ts`.

import Anthropic from '@anthropic-ai/sdk';

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

const DEFAULT_MODEL = 'claude-3-5-sonnet-latest';
const TIMEOUT_MS = 30_000;
const MAX_TOKENS = 4096;

export type ClaudeAdapterOptions = {
  apiKey?: string | undefined;
  model?: string | undefined;
  timeoutMs?: number | undefined;
};

type ClaudeMediaType = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';

function toClaudeMediaType(mime: string): ClaudeMediaType {
  switch (mime) {
    case 'image/png':
      return 'image/png';
    case 'image/webp':
      return 'image/webp';
    case 'image/gif':
      return 'image/gif';
    default:
      return 'image/jpeg';
  }
}

export function createClaudeAdapter(
  options: ClaudeAdapterOptions = {},
): OcrAdapter & { providerName: 'claude' } {
  const apiKey = options.apiKey ?? process.env['ANTHROPIC_API_KEY'] ?? '';
  const modelName = options.model ?? DEFAULT_MODEL;
  const timeoutMs = options.timeoutMs ?? TIMEOUT_MS;

  return {
    providerName: 'claude',

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
            message: 'anthropic api key not configured',
            provider: 'claude',
            retryable: false,
          },
        };
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const image = await fetchImageForOcr(imageUrl, controller.signal);

        const client = new Anthropic({ apiKey });

        const message = await client.messages.create(
          {
            model: modelName,
            max_tokens: MAX_TOKENS,
            temperature: 0,
            system: OCR_SYSTEM_PROMPT,
            messages: [
              {
                role: 'user',
                content: [
                  {
                    type: 'image',
                    source: {
                      type: 'base64',
                      media_type: toClaudeMediaType(image.mimeType),
                      data: image.buffer.toString('base64'),
                    },
                  },
                  {
                    type: 'text',
                    text: 'Extract the label fields per your system instructions. Output JSON only.',
                  },
                ],
              },
            ],
          },
          { signal: controller.signal },
        );

        const textBlock = message.content.find(
          (c): c is Extract<typeof c, { type: 'text' }> => c.type === 'text',
        );
        if (!textBlock) {
          return {
            ok: false,
            error: validationError('claude', 'not_json'),
          };
        }

        const parsed = parseModelOutput(textBlock.text);
        if (!parsed.ok) {
          return {
            ok: false,
            error: validationError('claude', parsed.reason),
          };
        }

        const legacy = toLegacyOcrResult(parsed.value);
        const stats = fieldStats(legacy.fields);
        // eslint-disable-next-line no-console
        console.info('[ocr] success', {
          provider: 'claude',
          duration_ms: Date.now() - started,
          field_count: stats.fieldCount,
          avg_confidence: stats.avgConfidence,
        });

        return { ok: true, value: legacy };
      } catch (err) {
        const error = classifyProviderError('claude', err, apiKey);
        // eslint-disable-next-line no-console
        console.warn('[ocr] failure', {
          provider: 'claude',
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
