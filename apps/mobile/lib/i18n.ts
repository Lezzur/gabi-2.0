import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { en, tl } from '@gaia/shared/i18n'

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    tl: { translation: tl },
  },
  lng: 'en',
  fallbackLng: 'en',
  // Synchronous init — resources are local objects, no async fetch needed
  initImmediate: false,
  interpolation: { escapeValue: false },
})

export default i18n
