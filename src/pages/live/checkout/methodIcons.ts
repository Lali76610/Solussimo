import { Banknote, CreditCard, Landmark, Smartphone, type LucideIcon } from 'lucide-react'
import type { PaymentMethodKind } from '../../../lib/database.types'

export const METHOD_ICON: Record<PaymentMethodKind, LucideIcon> = { cash: Banknote, card: CreditCard, transfer: Landmark, cheque: Landmark, local: Smartphone }
