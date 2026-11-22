import { ShieldCheck, Sparkles } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { LanguageSwitcher } from './LanguageSwitcher'
import { Logo } from './Logo'

/** Mise en page commune des écrans publics : panneau de marque + contenu. */
export function AuthShell({ children, footer }: { children: ReactNode; footer?: ReactNode }) {
  const { t } = useTranslation()
  return (
    <div className="grid min-h-dvh lg:grid-cols-2">
      <section className="relative hidden overflow-hidden bg-brand lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div className="pointer-events-none absolute -top-32 -right-32 size-[28rem] rounded-full bg-brand-light/20" aria-hidden="true" />
        <div className="pointer-events-none absolute -bottom-40 -left-24 size-96 rounded-full border-[3rem] border-gold/30" aria-hidden="true" />
        <Logo variant="light" />
        <div className="relative max-w-md">
          <Sparkles className="mb-4 size-8 text-gold" aria-hidden="true" />
          <h2 className="font-display text-4xl leading-tight font-semibold text-white">{t('login.heroTitle')}</h2>
          <p className="mt-4 text-brand-light">{t('login.heroText')}</p>
        </div>
        <p className="relative flex items-center gap-2 text-sm text-brand-light">
          <ShieldCheck className="size-4 text-gold" aria-hidden="true" />
          {t('login.secure')}
        </p>
      </section>

      <section className="pt-safe pb-safe flex flex-col px-5 py-6 sm:px-10">
        <div className="flex items-center justify-between">
          <Link to="/connexion" aria-label="SOLUSSIMO">
            <Logo className="lg:invisible" />
          </Link>
          <LanguageSwitcher />
        </div>
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-10">{children}</div>
        <div className="mx-auto max-w-sm text-center text-xs text-slate-400">
          {footer ?? t('login.privacy')}{' '}
          <Link to="/confidentialite" className="font-medium text-brand hover:text-brand-dark">
            {t('common.privacy')}
          </Link>
        </div>
      </section>
    </div>
  )
}
