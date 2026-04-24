import { describe, it, expect } from 'vitest'
import en from './en.json'
import tl from './tl.json'

type JsonObject = Record<string, unknown>

function collectLeafKeys(obj: JsonObject, prefix = ''): string[] {
  const keys: string[] = []
  for (const [k, v] of Object.entries(obj)) {
    if (k === '_translator_notes') continue
    const path = prefix ? `${prefix}.${k}` : k
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      keys.push(...collectLeafKeys(v as JsonObject, path))
    } else {
      keys.push(path)
    }
  }
  return keys
}

function getAtPath(obj: JsonObject, path: string): unknown {
  return path.split('.').reduce<unknown>((node, key) => {
    if (node !== null && typeof node === 'object') {
      return (node as JsonObject)[key]
    }
    return undefined
  }, obj)
}

const enKeys = new Set(collectLeafKeys(en as unknown as JsonObject))
const tlKeys = new Set(collectLeafKeys(tl as unknown as JsonObject))

// Safety-critical paths where tl.json must differ from en.json.
// scan.counterfeit.* is expanded dynamically so new sub-keys are caught automatically.
// Paths that don't exist in en.json are skipped — the symmetry tests catch missing keys.
const SAFETY_CRITICAL_PATHS: string[] = [
  ...[...enKeys].filter(k => k.startsWith('scan.counterfeit.')),
  'product.toxicity.poison',
  'product.note_to_physician_label',
  'ocr.safety_gate.toxicity_i_warning',
  'ocr.safety_gate.toxicity_ii_warning',
]

describe('i18n completeness', () => {
  it('every key in en.json exists in tl.json', () => {
    const missing = [...enKeys].filter(k => !tlKeys.has(k))
    expect(
      missing,
      `en.json has ${missing.length} key(s) missing from tl.json:\n  ${missing.join('\n  ')}`,
    ).toHaveLength(0)
  })

  it('every key in tl.json exists in en.json', () => {
    const extra = [...tlKeys].filter(k => !enKeys.has(k))
    expect(
      extra,
      `tl.json has ${extra.length} key(s) not present in en.json:\n  ${extra.join('\n  ')}`,
    ).toHaveLength(0)
  })

  it('safety-critical keys in tl.json are not English placeholders', () => {
    const untranslated: string[] = []
    for (const path of SAFETY_CRITICAL_PATHS) {
      const enVal = getAtPath(en as unknown as JsonObject, path)
      const tlVal = getAtPath(tl as unknown as JsonObject, path)
      // Only flag when the key exists in en and tl still holds the identical English string
      if (typeof enVal === 'string' && tlVal === enVal) {
        untranslated.push(path)
      }
    }
    expect(
      untranslated,
      `${untranslated.length} safety-critical key(s) in tl.json are identical to English (not translated):\n  ${untranslated.join('\n  ')}`,
    ).toHaveLength(0)
  })
})
