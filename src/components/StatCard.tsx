import type { LucideIcon } from 'lucide-react'

interface StatCardProps {
  label: string
  value: string
  icon: LucideIcon
  trend?: { value: number; label: string }
  accent?: 'brand' | 'gold'
}

export function StatCard({ label, value, icon: Icon, trend, accent = 'brand' }: StatCardProps) {
  const iconBg = accent === 'gold' ? 'bg-gold-light text-gold-dark' : 'bg-brand-light text-brand-dark'
  return (
    <div className="card p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-slate-500">{label}</p>
        <span className={`grid size-9 place-items-center rounded-xl ${iconBg}`}>
          <Icon className="size-5" aria-hidden="true" />
        </span>
      </div>
      <p className="mt-2 text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">{value}</p>
      {trend && (
        <p className="mt-1 text-xs text-slate-500">
          <span className={trend.value >= 0 ? 'font-semibold text-brand' : 'font-semibold text-rose-600'}>
            {trend.value >= 0 ? '+' : ''}
            {trend.value} %
          </span>{' '}
          {trend.label}
        </p>
      )}
    </div>
  )
}
