import { Clock3 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { PageHeader } from '../../components/PageHeader'

/** Module pas encore relié aux données réelles (structure prévue pour les prochaines versions). */
export function LiveModulePage({ titleKey }: { titleKey: string }) {
  const { t } = useTranslation()
  return (
    <div>
      <PageHeader title={t(titleKey)} />
      <div className="card flex flex-col items-center px-6 py-14 text-center">
        <span className="grid size-14 place-items-center rounded-2xl bg-gold-light text-gold-dark">
          <Clock3 className="size-7" aria-hidden="true" />
        </span>
        <h2 className="mt-4 font-semibold text-slate-900">{t('live.emptyModuleTitle')}</h2>
        <p className="mt-2 max-w-md text-sm text-slate-500">{t('live.emptyModuleText')}</p>
      </div>
    </div>
  )
}
