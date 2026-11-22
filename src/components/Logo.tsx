interface LogoProps {
  variant?: 'dark' | 'light'
  className?: string
}

export function Logo({ variant = 'dark', className = '' }: LogoProps) {
  const text = variant === 'light' ? 'text-white' : 'text-brand'
  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      <svg viewBox="0 0 64 64" className="size-9 shrink-0" aria-hidden="true">
        <rect width="64" height="64" rx="16" fill={variant === 'light' ? '#FFFFFF' : '#008B8B'} />
        <path
          d="M42 22c-2-4-6-6-11-6-6 0-10 3-10 8 0 11 22 7 22 17 0 5-5 8-11 8-5 0-9-2-11-6"
          fill="none"
          stroke={variant === 'light' ? '#008B8B' : '#FFFFFF'}
          strokeWidth="5"
          strokeLinecap="round"
        />
        <circle cx="48" cy="16" r="4" fill="#C4A875" />
      </svg>
      <span className={`font-display text-xl font-semibold tracking-[0.18em] ${text}`}>SOLUSSIMO</span>
    </div>
  )
}
