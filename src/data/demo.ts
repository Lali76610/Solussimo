/**
 * DONNÉES DE DÉMONSTRATION — ENTIÈREMENT FICTIVES.
 *
 * Aucune donnée ne correspond à une personne réelle. Les clients sont
 * volontairement réduits à un prénom + une initiale (minimisation RGPD) et
 * aucun e-mail ni numéro de téléphone n'est stocké dans le code.
 * En production, ces données proviendront d'une API authentifiée.
 */

export type StaffRole = 'manager' | 'stylist' | 'colorist' | 'beautician' | 'apprentice'
export type ServiceKey = 'cut' | 'cutBlowdry' | 'color' | 'highlights' | 'beard' | 'manicure' | 'facial' | 'kidsCut'
export type AppointmentStatus = 'confirmed' | 'pending' | 'done'
export type PaymentMethod = 'card' | 'cash' | 'contactless'

export interface Staff {
  id: string
  name: string
  role: StaffRole
  color: string
  present: boolean
}

export interface Appointment {
  id: string
  start: string // HH:mm
  duration: number // minutes
  client: string
  service: ServiceKey
  staffId: string
  status: AppointmentStatus
}

export interface Client {
  id: string
  name: string
  visits: number
  lastVisitDaysAgo: number
  totalSpent: number
  segment: 'vip' | 'regular' | 'new'
}

export interface Transaction {
  id: string
  time: string
  service: ServiceKey
  method: PaymentMethod
  amount: number
}

export interface StockItem {
  id: string
  product: 'shampoo' | 'conditioner' | 'mask' | 'colorTube' | 'oxidant' | 'serum' | 'nailPolish' | 'gloves'
  category: 'hair' | 'color' | 'care' | 'consumable'
  quantity: number
  minimum: number
  unitPrice: number
}

export const SALON = {
  name: 'Maison Élégance',
  city: 'Lyon',
  openingHours: { start: 9, end: 19 },
} as const

export const SERVICE_PRICES: Record<ServiceKey, number> = {
  cut: 32,
  cutBlowdry: 48,
  color: 68,
  highlights: 95,
  beard: 22,
  manicure: 35,
  facial: 70,
  kidsCut: 18,
}

export const staff: Staff[] = [
  { id: 's1', name: 'Camille R.', role: 'manager', color: '#008B8B', present: true },
  { id: 's2', name: 'Inès T.', role: 'colorist', color: '#C4A875', present: true },
  { id: 's3', name: 'Hugo M.', role: 'stylist', color: '#5FB3B3', present: true },
  { id: 's4', name: 'Sofia L.', role: 'beautician', color: '#9C7E4F', present: true },
  { id: 's5', name: 'Noah P.', role: 'apprentice', color: '#7FA7C9', present: false },
]

export const appointments: Appointment[] = [
  { id: 'a1', start: '09:00', duration: 45, client: 'Léa B.', service: 'cutBlowdry', staffId: 's1', status: 'done' },
  { id: 'a2', start: '09:30', duration: 120, client: 'Margaux D.', service: 'highlights', staffId: 's2', status: 'done' },
  { id: 'a3', start: '10:00', duration: 30, client: 'Julien F.', service: 'cut', staffId: 's3', status: 'done' },
  { id: 'a4', start: '10:30', duration: 60, client: 'Clara V.', service: 'facial', staffId: 's4', status: 'confirmed' },
  { id: 'a5', start: '11:00', duration: 45, client: 'Anaïs G.', service: 'cutBlowdry', staffId: 's1', status: 'confirmed' },
  { id: 'a6', start: '11:15', duration: 20, client: 'Thomas K.', service: 'beard', staffId: 's3', status: 'confirmed' },
  { id: 'a7', start: '12:00', duration: 90, client: 'Élise N.', service: 'color', staffId: 's2', status: 'confirmed' },
  { id: 'a8', start: '14:00', duration: 45, client: 'Chloé S.', service: 'manicure', staffId: 's4', status: 'pending' },
  { id: 'a9', start: '14:30', duration: 30, client: 'Maël C.', service: 'kidsCut', staffId: 's3', status: 'confirmed' },
  { id: 'a10', start: '15:00', duration: 45, client: 'Zoé H.', service: 'cutBlowdry', staffId: 's1', status: 'pending' },
  { id: 'a11', start: '16:00', duration: 120, client: 'Lucie A.', service: 'highlights', staffId: 's2', status: 'confirmed' },
  { id: 'a12', start: '17:30', duration: 60, client: 'Nina W.', service: 'facial', staffId: 's4', status: 'confirmed' },
]

export const clients: Client[] = [
  { id: 'c1', name: 'Léa B.', visits: 24, lastVisitDaysAgo: 0, totalSpent: 1180, segment: 'vip' },
  { id: 'c2', name: 'Margaux D.', visits: 15, lastVisitDaysAgo: 0, totalSpent: 1425, segment: 'vip' },
  { id: 'c3', name: 'Julien F.', visits: 9, lastVisitDaysAgo: 0, totalSpent: 288, segment: 'regular' },
  { id: 'c4', name: 'Clara V.', visits: 6, lastVisitDaysAgo: 34, totalSpent: 420, segment: 'regular' },
  { id: 'c5', name: 'Anaïs G.', visits: 1, lastVisitDaysAgo: 61, totalSpent: 48, segment: 'new' },
  { id: 'c6', name: 'Thomas K.', visits: 12, lastVisitDaysAgo: 21, totalSpent: 264, segment: 'regular' },
  { id: 'c7', name: 'Élise N.', visits: 18, lastVisitDaysAgo: 45, totalSpent: 1224, segment: 'vip' },
  { id: 'c8', name: 'Chloé S.', visits: 2, lastVisitDaysAgo: 28, totalSpent: 70, segment: 'new' },
]

export const transactions: Transaction[] = [
  { id: 't1', time: '09:48', service: 'cutBlowdry', method: 'card', amount: 48 },
  { id: 't2', time: '10:32', service: 'cut', method: 'contactless', amount: 32 },
  { id: 't3', time: '11:41', service: 'highlights', method: 'card', amount: 95 },
  { id: 't4', time: '11:50', service: 'beard', method: 'cash', amount: 22 },
  { id: 't5', time: '12:15', service: 'cutBlowdry', method: 'contactless', amount: 48 },
]

export const stock: StockItem[] = [
  { id: 'p1', product: 'shampoo', category: 'hair', quantity: 18, minimum: 10, unitPrice: 14.9 },
  { id: 'p2', product: 'conditioner', category: 'hair', quantity: 7, minimum: 10, unitPrice: 16.5 },
  { id: 'p3', product: 'mask', category: 'care', quantity: 12, minimum: 6, unitPrice: 22 },
  { id: 'p4', product: 'colorTube', category: 'color', quantity: 3, minimum: 15, unitPrice: 8.2 },
  { id: 'p5', product: 'oxidant', category: 'color', quantity: 9, minimum: 8, unitPrice: 11 },
  { id: 'p6', product: 'serum', category: 'care', quantity: 4, minimum: 5, unitPrice: 27 },
  { id: 'p7', product: 'nailPolish', category: 'care', quantity: 26, minimum: 12, unitPrice: 9.5 },
  { id: 'p8', product: 'gloves', category: 'consumable', quantity: 2, minimum: 5, unitPrice: 12 },
]

/** Chiffre d'affaires des 7 derniers jours (fictif). */
export const weeklyRevenue = [612, 845, 730, 980, 1124, 1390, 245]
