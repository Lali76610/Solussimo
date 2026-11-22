/**
 * Traduit les erreurs Supabase / PostgreSQL en clés i18n.
 * Messages volontairement génériques : ne révèlent jamais si un compte existe.
 */
export function authErrorKey(error: unknown): string {
  const e = error as { code?: string; message?: string; status?: number } | null
  const code = e?.code ?? ''
  const msg = (e?.message ?? '').toLowerCase()

  if (code === 'invalid_credentials' || msg.includes('invalid login credentials')) return 'errors.credentials'
  if (code === 'email_not_confirmed' || msg.includes('email not confirmed')) return 'errors.emailNotConfirmed'
  if (code === 'weak_password' || msg.includes('password should')) return 'errors.weakPassword'
  if (code === 'over_request_rate_limit' || code === 'over_email_send_rate_limit' || e?.status === 429) return 'errors.rateLimited'
  if (code === 'same_password') return 'errors.samePassword'
  if (msg.includes('company_limit_reached')) return 'errors.companyLimit'
  if (msg.includes('invalid_timezone')) return 'errors.invalidTimezone'
  if (msg.includes('sole_owner_of_company')) return 'errors.soleOwner'
  if (msg.includes('confirmation_mismatch')) return 'errors.confirmationMismatch'
  if (code === '42501' || msg.includes('row-level security') || msg.includes('forbidden')) return 'errors.forbidden'
  if (code === '23514' || code === '22023') return 'errors.invalidInput'
  if (msg.includes('failed to fetch') || msg.includes('network')) return 'errors.network'
  return 'errors.generic'
}
