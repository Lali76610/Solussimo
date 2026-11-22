import { Info } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export function DemoNotice() {
  const { t } = useTranslation()
  return (
    <p className="mt-8 flex items-start gap-2 rounded-xl border border-dashed border-gold bg-gold-light/40 px-4 py-3 text-xs text-gold-dark">
      <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <span>
        <strong>{t('common.demoData')}.</strong> {t('common.moduleInDev')}
      </span>
    </p>
  )
}
