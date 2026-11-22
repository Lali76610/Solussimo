import { UserPlus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Avatar } from '../components/Avatar'
import { DemoNotice } from '../components/DemoNotice'
import { PageHeader } from '../components/PageHeader'
import { appointments, staff } from '../data/demo'

export function StaffPage() {
  const { t } = useTranslation()
  return (
    <div>
      <PageHeader
        title={t('staff.title')}
        subtitle={t('staff.subtitle')}
        actions={
          <button type="button" className="btn-primary">
            <UserPlus className="size-4" aria-hidden="true" /> {t('staff.addMember')}
          </button>
        }
      />
      <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {staff.map((s) => {
          const count = appointments.filter((a) => a.staffId === s.id).length
          return (
            <li key={s.id} className="card overflow-hidden">
              <div className="h-1.5" style={{ backgroundColor: s.color }} />
              <div className="flex items-center gap-4 p-5">
                <Avatar name={s.name} color={s.color} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-slate-900">{s.name}</p>
                  <p className="text-sm text-slate-500">{t(`roles.${s.role}`)}</p>
                </div>
                <span className={`badge ${s.present ? 'bg-brand-light text-brand-dark' : 'bg-slate-100 text-slate-500'}`}>
                  {s.present ? t('dashboard.present') : t('dashboard.absent')}
                </span>
              </div>
              <div className="border-t border-slate-100 px-5 py-3 text-sm text-slate-600">
                {t('staff.appointmentsToday', { count })}
              </div>
            </li>
          )
        })}
      </ul>
      <DemoNotice />
    </div>
  )
}
