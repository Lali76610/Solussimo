import { CheckCircle2, AlertCircle } from 'lucide-react'

export function FormMessage({ kind, children }: { kind: 'error' | 'success'; children: React.ReactNode }) {
  if (!children) return null
  const Icon = kind === 'error' ? AlertCircle : CheckCircle2
  return (
    <p
      role={kind === 'error' ? 'alert' : 'status'}
      className={`flex items-start gap-2 rounded-lg px-3 py-2 text-sm ${
        kind === 'error' ? 'bg-rose-50 text-rose-700' : 'bg-brand-50 text-brand-dark'
      }`}
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </p>
  )
}
