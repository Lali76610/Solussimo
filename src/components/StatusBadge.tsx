import { useTranslation } from 'react-i18next'
import type { AppointmentStatus } from '../data/demo'

const styles: Record<AppointmentStatus, string> = {
  confirmed: 'bg-brand-light text-brand-dark',
  pending: 'bg-gold-light text-gold-dark',
  done: 'bg-slate-100 text-slate-500',
}

export function StatusBadge({ status }: { status: AppointmentStatus }) {
  const { t } = useTranslation()
  return <span className={`badge ${styles[status]}`}>{t(`status.${status}`)}</span>
}
