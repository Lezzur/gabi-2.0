// Structured extraction prompt + response schema for OCR providers.
//
// The same prompt + schema are used by both the Gemini and Claude adapters so
// that fallback produces shape-equivalent output. Validation is enforced by
// Zod before any extracted data is returned to business logic.

import { z } from 'zod';

/**
 * Canonical scalar (string) fields the model is asked to extract.
 * Adding/removing entries here means updating the prompt + schema together.
 */
export const SCALAR_FIELD_KEYS = [
  'product_name',
  'active_ingredient',
  'concentration',
  'formulation_type',
  'toxicity_category',
  'manufacture_date',
  'expiry_date',
  'batch_number',
  'fpa_registration',
  'manufacturer_name',
  'note_to_physician',
  'warnings_text',
] as const;

/** Array (string[]) fields. */
export const ARRAY_FIELD_KEYS = ['target_crops', 'target_pests'] as const;

export type ScalarFieldKey = (typeof SCALAR_FIELD_KEYS)[number];
export type ArrayFieldKey = (typeof ARRAY_FIELD_KEYS)[number];
export type FieldKey = ScalarFieldKey | ArrayFieldKey;

export const ALL_FIELD_KEYS: readonly FieldKey[] = [
  ...SCALAR_FIELD_KEYS,
  ...ARRAY_FIELD_KEYS,
];

/**
 * The prompt is intentionally strict about (a) JSON-only output, (b) using
 * `null` for absent fields rather than guessing, and (c) keeping confidence
 * inside [0, 1]. The adapter still clamps confidence after parsing.
 */
export const OCR_SYSTEM_PROMPT = `You extract structured registration data from a Philippine agrochemical product label image.

Extract ONLY what is explicitly printed on the label. Do NOT infer, translate, or fabricate values. If a field is not visible, set its "value" to null.

Return ONLY a single JSON object with this exact shape — no prose, no markdown, no code fences:

{
  "fields": {
    "product_name":       { "value": <string|null>, "confidence": <number 0..1> },
    "active_ingredient":  { "value": <string|null>, "confidence": <number 0..1> },
    "concentration":      { "value": <string|null>, "confidence": <number 0..1> },
    "formulation_type":   { "value": <string|null>, "confidence": <number 0..1> },
    "toxicity_category":  { "value": <string|null>, "confidence": <number 0..1> },
    "manufacture_date":   { "value": <string|null>, "confidence": <number 0..1> },
    "expiry_date":        { "value": <string|null>, "confidence": <number 0..1> },
    "batch_number":       { "value": <string|null>, "confidence": <number 0..1> },
    "fpa_registration":   { "value": <string|null>, "confidence": <number 0..1> },
    "manufacturer_name":  { "value": <string|null>, "confidence": <number 0..1> },
    "note_to_physician":  { "value": <string|null>, "confidence": <number 0..1> },
    "warnings_text":      { "value": <string|null>, "confidence": <number 0..1> },
    "target_crops":       { "value": <string[]|null>, "confidence": <number 0..1> },
    "target_pests":       { "value": <string[]|null>, "confidence": <number 0..1> }
  },
  "raw_text": <string>
}

Field guidance:
- product_name: brand / commercial name as printed.
- active_ingredient: chemical name(s); copy as shown including punctuation.
- concentration: e.g. "10% EC", "480 g/L".
- formulation_type: e.g. "EC", "SC", "WP", "GR".
- toxicity_category: as printed — "I", "II", "Category 3", etc.
- manufacture_date / expiry_date: ISO format (YYYY-MM-DD) when possible; otherwise verbatim.
- batch_number, fpa_registration, manufacturer_name: verbatim.
- note_to_physician: full verbatim sentence(s); never truncate.
- warnings_text: full verbatim hazard / precaution block.
- target_crops, target_pests: array of distinct items as printed; null if no list visible.
- raw_text: full transcript of all readable text on the label, in reading order.

Confidence is your own self-rating for that single field, in [0, 1]. 0.9+ for unambiguous prints; below 0.5 for partially obscured or hard-to-read text.

Output a single valid JSON object. No explanation. No markdown.`;

// ---- Zod schema ----

const ConfidenceSchema = z.number().finite();

const ScalarFieldSchema = z.object({
  value: z.union([z.string(), z.null()]),
  confidence: ConfidenceSchema,
});

const ArrayFieldSchema = z.object({
  value: z.union([z.array(z.string()), z.null()]),
  confidence: ConfidenceSchema,
});

const scalarShape = Object.fromEntries(
  SCALAR_FIELD_KEYS.map((k) => [k, ScalarFieldSchema] as const),
) as Record<ScalarFieldKey, typeof ScalarFieldSchema>;

const arrayShape = Object.fromEntries(
  ARRAY_FIELD_KEYS.map((k) => [k, ArrayFieldSchema] as const),
) as Record<ArrayFieldKey, typeof ArrayFieldSchema>;

export const OcrModelResponseSchema = z.object({
  fields: z.object({ ...scalarShape, ...arrayShape }),
  raw_text: z.string(),
});

export type OcrModelResponse = z.infer<typeof OcrModelResponseSchema>;

// ---- Parsing helpers ----

/** Clamp a number to [0, 1]; coerce NaN/Infinity to 0. */
export function clampConfidence(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

/**
 * Strip common code-fence wrappers (` ```json … ``` `) and parse JSON.
 * Returns null if the text isn't parseable JSON.
 */
function tryParseJson(text: string): unknown {
  const trimmed = text.trim();
  // Strip a leading ```json / ``` fence and a trailing ``` if present.
  const fenceMatch = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(trimmed);
  const body = fenceMatch?.[1] ?? trimmed;
  try {
    return JSON.parse(body);
  } catch {
    // Fall back: extract the first {...} block.
    const start = body.indexOf('{');
    const end = body.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(body.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

export type ParseOk = { ok: true; value: OcrModelResponse };
export type ParseFail = { ok: false; reason: 'not_json' | 'schema_mismatch' };

/**
 * Parse the model's text output into a validated, confidence-clamped
 * OcrModelResponse. Never throws.
 */
export function parseModelOutput(text: string): ParseOk | ParseFail {
  const raw = tryParseJson(text);
  if (raw === null) return { ok: false, reason: 'not_json' };

  const result = OcrModelResponseSchema.safeParse(raw);
  if (!result.success) return { ok: false, reason: 'schema_mismatch' };

  // Clamp every confidence into [0, 1]. Mutating the validated object is safe
  // here — Zod returns a fresh, owned copy from safeParse.
  for (const entry of Object.values(result.data.fields)) {
    entry.confidence = clampConfidence(entry.confidence);
  }

  return { ok: true, value: result.data };
}

// ---- Image fetch helper (shared by all providers) ----

const SUPPORTED_MIME = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
]);

export type FetchedImage = { buffer: Buffer; mimeType: string };

/**
 * Fetch an image URL and return its bytes + content-type. Throws on
 * non-2xx, unsupported mime, or abort. The caller is responsible for
 * supplying an AbortSignal that enforces the per-call deadline.
 */
export async function fetchImageForOcr(
  imageUrl: string,
  signal: AbortSignal,
): Promise<FetchedImage> {
  const res = await fetch(imageUrl, { signal });
  if (!res.ok) {
    throw new Error(`image fetch failed: HTTP ${res.status}`);
  }
  const mimeType = (res.headers.get('content-type') ?? '')
    .split(';')[0]
    ?.trim()
    .toLowerCase() ?? '';
  if (!SUPPORTED_MIME.has(mimeType)) {
    throw new Error(
      `image fetch returned unsupported content-type: ${mimeType || '<missing>'}`,
    );
  }
  const ab = await res.arrayBuffer();
  return {
    buffer: Buffer.from(ab),
    // Normalise jpg → jpeg (some CDNs return the short form).
    mimeType: mimeType === 'image/jpg' ? 'image/jpeg' : mimeType,
  };
}
