import type { StaffJob, TimeOffKind } from '../../lib/database.types'

export const JOBS: StaffJob[] = ['stylist', 'colorist', 'beautician', 'nail_technician', 'barber', 'manager', 'apprentice', 'receptionist']
export const STAFF_COLORS = ['#008B8B', '#C4A875', '#5FB3B3', '#9C7E4F', '#7FA7C9', '#B57FA3', '#6B9E78', '#D08770']
export const TIME_OFF_KINDS: TimeOffKind[] = ['vacation', 'absence', 'training', 'other']
