import { useContext } from 'react'
import { TenantContext } from './TenantContext'

export function useTenant() {
  const ctx = useContext(TenantContext)
  if (!ctx) throw new Error('useTenant doit être utilisé dans <TenantProvider>')
  return ctx
}
