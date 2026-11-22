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
  // Erreurs métier explicites renvoyées par les fonctions serveur (avant les codes génériques).
  const business: [string, string][] = [
    ['slot_unavailable', 'errors.slotUnavailable'],
    ['outside_working_hours', 'errors.outsideWorkingHours'],
    ['staff_on_leave', 'errors.staffOnLeave'],
    ['staff_unavailable', 'errors.staffUnavailable'],
    ['service_unavailable', 'errors.serviceUnavailable'],
    ['resource_unavailable', 'errors.resourceUnavailable'],
    ['version_conflict', 'errors.versionConflict'],
    ['invalid_local_time', 'errors.invalidLocalTime'],
    ['appointment_not_editable', 'errors.appointmentNotEditable'],
    ['staff_working_hours_no_overlap', 'errors.hoursOverlap'],
    ['invitation_email_mismatch', 'errors.invitationEmailMismatch'],
    ['invitation_invalid', 'errors.invitationInvalid'],
    ['invitation_limit_reached', 'errors.invitationLimit'],
    ['already_member', 'errors.alreadyMember'],
    ['forbidden_role', 'errors.forbiddenRole'],
    ['invalid_staff', 'errors.invalidInput'],
    ['cannot_remove_primary_establishment', 'errors.primaryEstablishment'],
    ['staff_not_assigned', 'errors.staffNotAssigned'],
    ['health_consent_required', 'errors.healthConsentRequired'],
    ['health_data_disabled', 'errors.healthDisabled'],
    ['legal_acknowledgement_required', 'errors.legalAckRequired'],
    ['invalid_health_notes', 'errors.invalidInput'],
    ['query_too_short', 'errors.queryTooShort'],
    ['client_unavailable', 'errors.clientUnavailable'],
    ['client_required', 'errors.clientRequired'],
    ['invalid_merge', 'errors.invalidInput'],
    ['clients_company_email_uidx', 'errors.clientEmailExists'],
    ['clients_company_phone_uidx', 'errors.clientPhoneExists'],
    ['confirmation_required', 'errors.confirmationMismatch'],
    // Caisse (V0.5)
    ['register_already_open', 'errors.registerAlreadyOpen'],
    ['register_closed', 'errors.registerClosed'],
    ['payment_mismatch', 'errors.paymentMismatch'],
    ['card_number_forbidden', 'errors.cardNumberForbidden'],
    ['invalid_payment', 'errors.invalidPayment'],
    ['discount_reason_required', 'errors.discountReasonRequired'],
    ['discount_cap_exceeded', 'errors.discountCapExceeded'],
    ['discount_approval_required', 'errors.discountApprovalRequired'],
    ['too_many_attempts', 'errors.tooManyAttempts'],
    ['appointment_already_paid', 'errors.appointmentAlreadyPaid'],
    ['appointment_unavailable', 'errors.appointmentUnavailable'],
    ['deposit_unavailable', 'errors.depositUnavailable'],
    ['deposit_exceeds_total', 'errors.depositExceedsTotal'],
    ['deposit_already_applied', 'errors.depositAlreadyApplied'],
    ['refund_reason_required', 'errors.refundReasonRequired'],
    ['refund_exceeds_remaining', 'errors.refundExceedsRemaining'],
    ['not_refundable', 'errors.notRefundable'],
    ['difference_reason_required', 'errors.differenceReasonRequired'],
    ['period_not_ended', 'errors.periodNotEnded'],
    ['open_sessions_in_period', 'errors.openSessionsInPeriod'],
    ['period_already_closed', 'errors.periodAlreadyClosed'],
    ['invalid_buyer', 'errors.invalidBuyer'],
    ['tax_rate_missing', 'errors.taxRateMissing'],
    ['fiscal_records_retained', 'errors.fiscalRecordsRetained'],
  ]
  for (const [needle, key] of business) if (msg.includes(needle)) return key
  if (msg.includes('company_limit_reached')) return 'errors.companyLimit'
  if (msg.includes('invalid_timezone')) return 'errors.invalidTimezone'
  if (msg.includes('sole_owner_of_company')) return 'errors.soleOwner'
  if (msg.includes('confirmation_mismatch')) return 'errors.confirmationMismatch'
  if (code === '42501' || msg.includes('row-level security') || msg.includes('forbidden')) return 'errors.forbidden'
  if (code === '23514' || code === '22023') return 'errors.invalidInput'
  if (msg.includes('failed to fetch') || msg.includes('network')) return 'errors.network'
  return 'errors.generic'
}
