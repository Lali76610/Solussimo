import { Globe } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { SUPPORTED_LANGUAGES } from '../i18n'

export function LanguageSwitcher({ className = '' }: { className?: string }) {
  const { i18n, t } = useTranslation()
  const current = i18n.resolvedLanguage ?? 'fr'
  return (
    <label className={`relative inline-flex items-center ${className}`}>
      <span className="sr-only">{t('common.language')}</span>
      <Globe className="pointer-events-none absolute left-2.5 size-4 text-slate-500" aria-hidden="true" />
      <select
        value={current}
        onChange={(e) => void i18n.changeLanguage(e.target.value)}
        className="min-h-10 cursor-pointer appearance-none rounded-lg border border-slate-200 bg-white py-1.5 pr-3 pl-8 text-sm font-medium text-slate-700 hover:border-brand focus:border-brand focus:outline-none"
      >
        {SUPPORTED_LANGUAGES.map((l) => (
          <option key={l.code} value={l.code}>
            {l.code.toUpperCase()} · {l.label}
          </option>
        ))}
      </select>
    </label>
  )
}
