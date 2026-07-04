import i18n from 'i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import { initReactI18next } from 'react-i18next'
import en from './locales/en.json'
import es from './locales/es.json'
import vi from './locales/vi.json'
import zh from './locales/zh.json'

export const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Español' },
  { code: 'vi', label: 'Tiếng Việt' },
  { code: 'zh', label: '中文' },
]

/** BCP-47 tags for date formatting per app language. */
export const DATE_LOCALES = { en: 'en-US', es: 'es-US', vi: 'vi-VN', zh: 'zh-CN' }

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      es: { translation: es },
      vi: { translation: vi },
      zh: { translation: zh },
    },
    supportedLngs: ['en', 'es', 'vi', 'zh'],
    fallbackLng: 'en',
    nonExplicitSupportedLngs: true, // es-MX -> es, zh-CN -> zh
    detection: {
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: 'groma-lang',
      caches: ['localStorage'],
    },
    interpolation: {
      escapeValue: false, // React escapes; Trans handles markup
    },
  })

export default i18n
