import { LogOut, Menu, MoreHorizontal, ShieldCheck, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { NavLink, Outlet, useLocation } from 'react-router'
import { useAuth } from '../auth/useAuth'
import { Avatar } from '../components/Avatar'
import { LanguageSwitcher } from '../components/LanguageSwitcher'
import { Logo } from '../components/Logo'
import { NAV_ITEMS } from './navigation'

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const { t } = useTranslation()
  const { user, logout } = useAuth()
  return (
    <div className="flex h-full flex-col">
      <div className="px-5 py-6">
        <Logo />
      </div>
      <div className="mx-4 mb-4 rounded-xl bg-brand-50 px-3 py-3">
        <p className="text-[11px] font-semibold tracking-wider text-gold-dark uppercase">{t('common.salon')}</p>
        <p className="font-display text-base font-semibold text-brand-dark">{user?.salonName}</p>
      </div>
      <nav aria-label={t('nav.mainNav')} className="flex-1 space-y-1 px-3">
        {NAV_ITEMS.map(({ to, labelKey, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            onClick={onNavigate}
            className={({ isActive }) =>
              `flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-medium transition ${
                isActive ? 'bg-brand text-white shadow-sm' : 'text-slate-600 hover:bg-brand-50 hover:text-brand-dark'
              }`
            }
          >
            <Icon className="size-5" aria-hidden="true" />
            {t(labelKey)}
          </NavLink>
        ))}
      </nav>
      <div className="space-y-3 border-t border-slate-100 p-4">
        <p className="flex items-center gap-1.5 text-[11px] text-slate-400">
          <ShieldCheck className="size-3.5 text-brand" aria-hidden="true" />
          {t('common.privacy')}
        </p>
        <div className="flex items-center gap-3">
          <Avatar name={user?.displayName ?? '?'} size="sm" />
          <span className="flex-1 truncate text-sm font-medium text-slate-700">{user?.displayName}</span>
          <button
            type="button"
            onClick={logout}
            className="grid size-10 place-items-center rounded-lg text-slate-500 hover:bg-rose-50 hover:text-rose-600"
            aria-label={t('nav.logout')}
            title={t('nav.logout')}
          >
            <LogOut className="size-5" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  )
}

export function AppLayout() {
  const { t } = useTranslation()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const location = useLocation()

  // Ferme le tiroir et remonte en haut à chaque changement de page.
  useEffect(() => {
    window.scrollTo({ top: 0 })
  }, [location.pathname])

  useEffect(() => {
    if (!drawerOpen) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setDrawerOpen(false)
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [drawerOpen])

  const currentLabel = NAV_ITEMS.find((i) => (i.to === '/' ? location.pathname === '/' : location.pathname.startsWith(i.to)))

  return (
    <div className="min-h-dvh bg-slate-50/60">
      {/* Barre latérale — ordinateur */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-slate-200 bg-white lg:block">
        <SidebarContent />
      </aside>

      {/* Tiroir — mobile */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true">
          <button
            type="button"
            className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            onClick={() => setDrawerOpen(false)}
            aria-label={t('nav.closeMenu')}
          />
          <div className="pt-safe pb-safe absolute inset-y-0 left-0 w-72 max-w-[85vw] bg-white shadow-xl">
            <button
              type="button"
              onClick={() => setDrawerOpen(false)}
              className="absolute top-5 right-3 grid size-10 place-items-center rounded-lg text-slate-500 hover:bg-slate-100"
              aria-label={t('nav.closeMenu')}
            >
              <X className="size-5" aria-hidden="true" />
            </button>
            <SidebarContent onNavigate={() => setDrawerOpen(false)} />
          </div>
        </div>
      )}

      <div className="lg:pl-64">
        {/* En-tête */}
        <header className="pt-safe sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur">
          <div className="flex h-16 items-center gap-3 px-4 sm:px-6">
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              className="grid size-10 place-items-center rounded-lg text-slate-600 hover:bg-slate-100 lg:hidden"
              aria-label={t('nav.openMenu')}
            >
              <Menu className="size-6" aria-hidden="true" />
            </button>
            <p className="flex-1 truncate text-sm font-semibold text-slate-700 lg:text-base">
              {currentLabel ? t(currentLabel.labelKey) : ''}
            </p>
            <LanguageSwitcher />
          </div>
        </header>

        <main className="mx-auto max-w-7xl px-4 pt-6 pb-28 sm:px-6 lg:pb-10">
          <Outlet />
        </main>
      </div>

      {/* Barre d'onglets — mobile */}
      <nav
        aria-label={t('nav.mainNav')}
        className="pb-safe fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 backdrop-blur lg:hidden"
      >
        <ul className="grid grid-cols-5">
          {NAV_ITEMS.filter((i) => i.mobileTab).map(({ to, labelKey, shortLabelKey, icon: Icon }) => (
            <li key={to}>
              <NavLink
                to={to}
                end={to === '/'}
                className={({ isActive }) =>
                  `flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-medium ${
                    isActive ? 'text-brand' : 'text-slate-500'
                  }`
                }
              >
                <Icon className="size-5" aria-hidden="true" />
                <span className="max-w-full truncate px-1">{t(shortLabelKey ?? labelKey)}</span>
              </NavLink>
            </li>
          ))}
          <li>
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              className="flex min-h-14 w-full flex-col items-center justify-center gap-0.5 text-[11px] font-medium text-slate-500"
            >
              <MoreHorizontal className="size-5" aria-hidden="true" />
              {t('nav.more')}
            </button>
          </li>
        </ul>
      </nav>
    </div>
  )
}
