import { defineRouting } from 'next-intl/routing';

export const routing = defineRouting({
  locales: ['en', 'tl'],
  defaultLocale: 'en',
  // No locale prefix in URLs — locale is cookie-driven (NEXT_LOCALE)
  localePrefix: 'never',
});
