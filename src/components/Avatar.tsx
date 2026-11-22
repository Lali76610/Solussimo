export function Avatar({ name, color = '#008B8B', size = 'md' }: { name: string; color?: string; size?: 'sm' | 'md' }) {
  const initials = name
    .split(/\s+/)
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()
  const dim = size === 'sm' ? 'size-8 text-xs' : 'size-10 text-sm'
  return (
    <span
      className={`grid shrink-0 place-items-center rounded-full font-semibold text-white ${dim}`}
      style={{ backgroundColor: color }}
      aria-hidden="true"
    >
      {initials}
    </span>
  )
}
