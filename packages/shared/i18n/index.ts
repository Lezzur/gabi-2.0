export { default as en } from './en.json';
export { default as tl } from './tl.json';
export type { I18nKey, Locale } from './types';

import en from './en.json';
import tl from './tl.json';

export const locales = { en, tl } as const;
export type LocaleCode = keyof typeof locales;
