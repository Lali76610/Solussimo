import { CalendarDays, LayoutDashboard, Package, Receipt, UserRound, Users, type LucideIcon } from 'lucide-react'

export interface NavItem {
  to: string
  labelKey: string
  icon: LucideIcon
  /** Affiché dans la barre d'onglets mobile */
  mobileTab?: boolean
  /** Libellé court pour la barre d'onglets mobile */
  shortLabelKey?: string
}

export const NAV_ITEMS: NavItem[] = [
  { to: '/', labelKey: 'nav.dashboard', icon: LayoutDashboard, mobileTab: true, shortLabelKey: 'nav.home' },
  { to: '/planning', labelKey: 'nav.planning', icon: CalendarDays, mobileTab: true },
  { to: '/clients', labelKey: 'nav.clients', icon: Users, mobileTab: true },
  { to: '/personnel', labelKey: 'nav.staff', icon: UserRound },
  { to: '/caisse', labelKey: 'nav.checkout', icon: Receipt, mobileTab: true },
  { to: '/stock', labelKey: 'nav.stock', icon: Package },
]
