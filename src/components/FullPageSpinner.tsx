import { useTranslation } from 'react-i18next'

export function FullPageSpinner() {
  const { t } = useTranslation()
  return (
    <div className="grid min-h-dvh place-items-center bg-white" role="status" aria-live="polite">
      <div className="flex flex-col items-center gap-3">
        <span className="size-10 animate-spin rounded-full border-4 border-brand-light border-t-brand" aria-hidden="true" />
        <span className="text-sm text-slate-500">{t('common.loading')}</span>
      </div>
    </div>
  )
}
