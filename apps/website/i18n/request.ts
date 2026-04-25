import { getRequestConfig } from 'next-intl/server';
import { routing } from './routing';
import { en as sharedEn, tl as sharedTl } from '@gaia/shared/i18n';
import siteEn from '../messages/en.json';
import siteTl from '../messages/tl.json';

type Locale = (typeof routing.locales)[number];

const sharedMessages = { en: sharedEn, tl: sharedTl } as const;
const siteMessages = { en: siteEn, tl: siteTl } as const;

export default getRequestConfig(async ({ requestLocale }) => {
  let locale = (await requestLocale) as Locale | undefined;
  if (!locale || !(routing.locales as readonly string[]).includes(locale)) {
    locale = routing.defaultLocale;
  }

  return {
    locale,
    messages: {
      ...sharedMessages[locale],
      ...siteMessages[locale],
    },
  };
});
