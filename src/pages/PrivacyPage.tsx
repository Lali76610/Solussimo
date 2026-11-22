import { ShieldCheck } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { AuthShell } from '../components/AuthShell'

const SECTIONS = ['data', 'purpose', 'isolation', 'storage', 'rights'] as const

export function PrivacyPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  return (
    <AuthShell footer={<span />}>
      <ShieldCheck className="size-10 text-brand" aria-hidden="true" />
      <h1 className="mt-3 font-display text-3xl font-semibold text-slate-900">{t('privacy.title')}</h1>
      <p className="mt-2 text-sm text-slate-600">{t('privacy.intro')}</p>
      <ul className="mt-6 space-y-3 text-sm text-slate-700">
        {SECTIONS.map((s) => (
          <li key={s} className="flex gap-2">
            <span className="mt-2 size-1.5 shrink-0 rounded-full bg-gold" aria-hidden="true" />
            <span>{t(`privacy.${s}`)}</span>
          </li>
        ))}
      </ul>
      <p className="mt-6 rounded-lg bg-gold-light/40 px-3 py-2 text-xs text-gold-dark">{t('privacy.draft')}</p>
      <button type="button" onClick={() => navigate(-1)} className="btn-secondary mt-6">
        {t('common.back')}
      </button>
    </AuthShell>
  )
}
