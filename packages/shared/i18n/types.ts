import type en from './en.json';

/** Shape of a complete locale file — use this to type locale objects. */
export type Locale = typeof en;

/**
 * Union of all valid dot-notation i18n keys derived from en.json.
 * Every `t('…')` call in the codebase typechecks against this union.
 *
 * Example valid keys:
 *   "errors.hmac_invalid"
 *   "scan.counterfeit.headline"
 *   "ocr.safety_gate.category_confirm_label"
 */
export type I18nKey = DotNotationKeys<Locale>;

type DotNotationKeys<T, Prefix extends string = ''> = {
  [K in keyof T & string]: T[K] extends Record<string, unknown>
    ? DotNotationKeys<T[K], `${Prefix}${K}.`>
    : `${Prefix}${K}`;
}[keyof T & string];
