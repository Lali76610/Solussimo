import i18n from 'i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import { initReactI18next } from 'react-i18next'
import de from './locales/de.json'
import en from './locales/en.json'
import es from './locales/es.json'
import fr from './locales/fr.json'

export const SUPPORTED_LANGUAGES = [
  { code: 'fr', label: 'Français', locale: 'fr-FR' },
  { code: 'en', label: 'English', locale: 'en-GB' },
  { code: 'es', label: 'Español', locale: 'es-ES' },
  { code: 'de', label: 'Deutsch', locale: 'de-DE' },
] as const

export type LanguageCode = (typeof SUPPORTED_LANGUAGES)[number]['code']

export function localeFor(code: string): string {
  return SUPPORTED_LANGUAGES.find((l) => l.code === code)?.locale ?? 'fr-FR'
}

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: { fr: { translation: fr }, en: { translation: en }, es: { translation: es }, de: { translation: de } },
    fallbackLng: 'fr',
    supportedLngs: SUPPORTED_LANGUAGES.map((l) => l.code),
    nonExplicitSupportedLngs: true,
    interpolation: { escapeValue: false }, // React échappe déjà le contenu (protection XSS)
    detection: {
      // Préférence de langue = stockage strictement nécessaire (pas de cookie, pas de traçage).
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: 'solussimo.lang',
      caches: ['localStorage'],
    },
  })

i18n.on('languageChanged', (lng) => {
  document.documentElement.lang = lng
})

export default i18n
