/**
 * Types de la base SOLUSSIMO (miroir des migrations supabase/migrations).
 * À régénérer automatiquement une fois le projet Supabase créé :
 *   npx supabase gen types typescript --project-id <id> > src/lib/database.types.ts
 */

export type CompanyRole = 'owner' | 'admin' | 'manager' | 'staff'
export type EstablishmentKind = 'hair_salon' | 'beauty_institute' | 'barbershop' | 'nail_salon' | 'spa'
export type StaffJob = 'manager' | 'stylist' | 'colorist' | 'beautician' | 'barber' | 'apprentice' | 'receptionist' | 'nail_technician'
export type TimeOffKind = 'vacation' | 'absence' | 'training' | 'other'
export type ResourceKind = 'cabin' | 'chair' | 'equipment'
export type AppointmentStatus = 'booked' | 'completed' | 'cancelled' | 'no_show'
export type ClientStatus = 'active' | 'archived' | 'anonymized'
export type TimeOfDay = 'morning' | 'afternoon' | 'evening'
export type TechnicalNoteKind = 'color_formula' | 'hair' | 'skin_type' | 'nails' | 'other'
export type ConsentPurpose = 'marketing' | 'newsletter' | 'appointment_reminders' | 'health_data'
export type ConsentChannel = 'email' | 'sms' | 'whatsapp' | 'postal' | 'none'
export type ConsentStatus = 'granted' | 'withdrawn'
export type ConsentMethod = 'in_salon_verbal' | 'in_salon_signed' | 'online_form' | 'import' | 'system'
export type FiscalMode = 'demo' | 'uncertified' | 'certified'
export type PaymentMethodKind = 'cash' | 'card' | 'transfer' | 'cheque' | 'local'
export type SaleKind = 'sale' | 'deposit' | 'credit_note'
export type SaleLineKind = 'service' | 'product' | 'custom' | 'deposit' | 'deposit_applied'
export type AppLocale = 'fr' | 'en' | 'es' | 'de'
export type Permission =
  | 'company.read'
  | 'company.update'
  | 'company.delete'
  | 'establishment.write'
  | 'establishment.delete'
  | 'membership.manage'
  | 'invitation.manage'
  | 'staff.write'
  | 'schedule.write'
  | 'service.write'
  | 'resource.write'
  | 'appointment.write'
  | 'audit.read'
  | 'client.read'
  | 'client.write'
  | 'client.contact.read'
  | 'client.merge'
  | 'client.export'
  | 'client.erase'
  | 'consent.write'
  | 'settings.health'
  | 'settings.retention'
  | 'register.operate'
  | 'refund.issue'
  | 'cash.movement'
  | 'discount.approve'
  | 'reports.read'
  | 'accounting.export'
  | 'catalog.write'
  | 'settings.fiscal'

export type ProfileRow = {
  id: string
  display_name: string
  locale: AppLocale
  created_at: string
  updated_at: string
}
export type CompanyRow = {
  id: string
  name: string
  country_code: string
  default_locale: AppLocale
  currency: string
  created_by: string | null
  created_at: string
  updated_at: string
  health_data_enabled: boolean
  health_data_enabled_at: string | null
  client_review_months: number
  accounting_retention_years: number
  discount_cap_staff_bp: number
  discount_cap_manager_bp: number
}
export type EstablishmentRow = {
  id: string
  company_id: string
  name: string
  kind: EstablishmentKind
  city: string | null
  country_code: string
  timezone: string
  created_at: string
  updated_at: string
}
export type MembershipRow = {
  id: string
  company_id: string
  user_id: string
  role: CompanyRole
  created_at: string
  updated_at: string
}
export type StaffMemberRow = {
  id: string
  company_id: string
  establishment_id: string
  user_id: string | null
  display_name: string
  job: StaffJob
  jobs: StaffJob[]
  bookable: boolean
  health_practitioner: boolean
  color: string
  active: boolean
  created_at: string
  updated_at: string
}
export type StaffEstablishmentRow = { staff_id: string; establishment_id: string; company_id: string; created_at: string }
export type WorkingHoursRow = {
  id: string
  company_id: string
  staff_id: string
  establishment_id: string
  weekday: number
  start_time: string
  end_time: string
  created_at: string
}
export type TimeOffRow = {
  id: string
  company_id: string
  staff_id: string
  kind: TimeOffKind
  starts_at: string
  ends_at: string
  created_by: string | null
  created_at: string
}
export type InvitationRow = {
  id: string
  company_id: string
  staff_id: string | null
  email: string
  role: CompanyRole
  expires_at: string
  created_by: string | null
  created_at: string
  accepted_at: string | null
  accepted_by: string | null
  revoked_at: string | null
}
export type ServiceRow = {
  id: string
  company_id: string
  name: string
  duration_minutes: number
  price_cents: number
  color: string
  resource_kind: ResourceKind | null
  active: boolean
  tax_code: string
  created_at: string
  updated_at: string
}
export type ResourceRow = {
  id: string
  company_id: string
  establishment_id: string
  name: string
  kind: ResourceKind
  active: boolean
  created_at: string
}
export type AppointmentRow = {
  id: string
  company_id: string
  establishment_id: string
  staff_id: string
  service_id: string
  resource_id: string | null
  starts_at: string
  ends_at: string
  status: AppointmentStatus
  client_label: string
  price_cents: number
  version: number
  created_by: string | null
  created_at: string
  updated_at: string
  cancelled_at: string | null
  cancelled_by: string | null
  client_id: string | null
}
/** Colonnes LISIBLES d'une fiche client (e-mail / téléphone en clair : jamais, cf. D2). */
export type ClientRow = {
  id: string
  company_id: string
  home_establishment_id: string
  first_name: string | null
  last_name: string | null
  email_masked: string | null
  phone_masked: string | null
  birthday_month: number | null
  birthday_day: number | null
  preferred_locale: AppLocale | null
  preferred_staff_id: string | null
  preferred_days: number[]
  preferred_time: TimeOfDay | null
  general_note: string | null
  tags: string[]
  status: ClientStatus
  merged_into: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}
export type ClientWritable = {
  company_id: string
  home_establishment_id: string
  first_name?: string | null
  last_name?: string | null
  email?: string | null
  phone_e164?: string | null
  birthday_month?: number | null
  birthday_day?: number | null
  preferred_locale?: AppLocale | null
  preferred_staff_id?: string | null
  preferred_days?: number[]
  preferred_time?: TimeOfDay | null
  general_note?: string | null
  tags?: string[]
}
export type ClientSearchRow = {
  id: string
  first_name: string | null
  last_name: string | null
  email_masked: string | null
  phone_masked: string | null
  tags: string[]
  home_establishment_id: string
  last_visit_at: string | null
  next_visit_at: string | null
  visits: number
  no_shows: number
  marketing_ok: boolean
  birthday_month: number | null
  birthday_day: number | null
}
export type ClientConsentRow = {
  id: string
  company_id: string
  client_id: string
  purpose: ConsentPurpose
  channel: ConsentChannel
  status: ConsentStatus
  method: ConsentMethod
  wording_version: string
  captured_by: string | null
  captured_at: string
}
export type TechnicalNoteRow = {
  id: string
  client_id: string
  company_id: string
  kind: TechnicalNoteKind
  content: string
  created_by: string | null
  created_at: string
}
export type FavoriteServiceRow = { client_id: string; service_id: string; company_id: string; created_at: string }
export type HealthNotes = { allergies?: string; contraindications?: string; treatments?: string; pregnancy?: boolean; other?: string }

// --- V0.5 Caisse ---------------------------------------------------------------------------
export type FiscalProfileRow = {
  establishment_id: string
  company_id: string
  country_code: string
  currency: string
  fiscal_mode: FiscalMode
  seller_legal_name: string | null
  seller_tax_id: string | null
  seller_vat_number: string | null
  seller_address: string | null
  legal_mentions: string | null
  b2c_invoice_threshold_cents: number
  updated_at: string
}
export type TaxRateRow = { id: string; company_id: string; country_code: string; code: string; label: string; rate_bp: number; valid_from: string; valid_to: string | null }
export type PaymentMethodRow = { id: string; company_id: string; kind: PaymentMethodKind; label: string; active: boolean; sort: number }
export type ProductRow = { id: string; company_id: string; name: string; sku: string | null; price_cents: number; tax_code: string; active: boolean; created_at: string }
export type CashRegisterRow = { id: string; company_id: string; establishment_id: string; name: string; active: boolean; created_at: string }
export type RegisterSessionRow = {
  id: string
  company_id: string
  establishment_id: string
  register_id: string
  status: 'open' | 'closed'
  opened_at: string
  opened_by: string | null
  opening_float_cents: number
  closed_at: string | null
  counted_cash_cents: number | null
  expected_cash_cents: number | null
  difference_cents: number | null
  difference_reason: string | null
}
export type SaleRow = {
  id: string
  company_id: string
  establishment_id: string
  register_session_id: string
  kind: SaleKind
  document_no: string
  client_id: string | null
  appointment_id: string | null
  original_sale_id: string | null
  currency: string
  subtotal_cents: number
  discount_cents: number
  total_cents: number
  tax_cents: number
  net_cents: number
  discount_reason: string | null
  refund_reason: string | null
  created_by: string | null
  completed_at: string
  hash: string | null
}
export type SaleLineRow = {
  id: string
  sale_id: string
  position: number
  kind: SaleLineKind
  service_id: string | null
  product_id: string | null
  ref_sale_id: string | null
  original_line_id: string | null
  staff_id: string | null
  label: string
  quantity: number
  unit_price_cents: number
  discount_cents: number
  tax_rate_bp: number
  total_cents: number
  tax_cents: number
}
export type SalePaymentRow = {
  id: string
  sale_id: string
  method_kind: PaymentMethodKind
  method_label: string
  amount_cents: number
  tendered_cents: number | null
  change_cents: number
  external_ref: string | null
  received_at: string
}
export type ClosureRow = {
  id: string
  establishment_id: string
  kind: 'z' | 'month' | 'year'
  session_id: string | null
  period_start: string
  period_end: string
  document_no: string
  currency: string
  total_cents: number
  tax_cents: number
  grand_total_cents: number
  created_at: string
}
export type InvoiceRow = { id: string; sale_id: string; document_no: string; buyer: { name: string; address?: string; vat_number?: string; tax_id?: string }; created_at: string }
export type AccountingAccountRow = { company_id: string; key: string; account: string; label: string }
export type ExportBatchRow = { id: string; format: 'csv' | 'fec'; period_start: string; period_end: string; rows: number; sha256: string; created_at: string }

export interface SaleTotals {
  count_sales: number
  count_deposits: number
  count_credit_notes: number
  total_cents: number
  tax_cents: number
  net_cents: number
  discount_cents: number
  refunds_cents: number
  by_method: { kind: PaymentMethodKind; label: string; amount_cents: number }[]
  by_rate: { rate_bp: number; net_cents: number; tax_cents: number; total_cents: number }[]
}
export interface SalesReport extends SaleTotals {
  scope: 'own' | 'establishment'
  currency: string
  by_day: { day: string; total_cents: number; count: number }[]
  by_staff: { staff_id: string | null; name: string; total_cents: number }[]
  by_item: { label: string; kind: SaleLineKind; quantity: number; total_cents: number }[]
}
export interface CompleteSalePayload {
  establishment_id: string
  session_id: string
  idempotency_key: string
  kind?: 'sale' | 'deposit'
  client_id?: string | null
  appointment_id?: string | null
  lines?: { kind: 'service' | 'product' | 'custom'; service_id?: string; product_id?: string; label?: string; unit_price_cents?: number; quantity: number; discount_bp?: number; staff_id?: string | null }[]
  deposit_amount_cents?: number
  ticket_discount_bp?: number
  discount_reason?: string | null
  approval_code?: string | null
  deposit_ids?: string[]
  payments: { method_id: string; amount_cents: number; tendered_cents?: number; external_ref?: string | null }[]
}
export type CompleteSaleResult =
  | { sale_id: string; document_no: string; total_cents: number; change_cents?: number; replayed: boolean; error?: undefined }
  | { error: 'discount_approval_required'; required_bp: number; sale_id?: undefined }

type Table<Row, Insert, Update> = { Row: Row; Insert: Insert; Update: Update; Relationships: [] }

export type Database = {
  // Version PostgREST utilisée par Supabase (requis par les types de supabase-js ≥ 2.50)
  __InternalSupabase: { PostgrestVersion: '12' }
  public: {
    Tables: {
      profiles: Table<ProfileRow, Record<string, never>, Partial<Pick<ProfileRow, 'display_name' | 'locale'>>>
      companies: Table<CompanyRow, Record<string, never>, Partial<Pick<CompanyRow, 'name' | 'country_code' | 'default_locale' | 'currency'>>>
      establishments: Table<
        EstablishmentRow,
        Pick<EstablishmentRow, 'company_id' | 'name' | 'country_code'> & Partial<Pick<EstablishmentRow, 'kind' | 'city' | 'timezone'>>,
        Partial<Pick<EstablishmentRow, 'name' | 'kind' | 'city' | 'country_code' | 'timezone'>>
      >
      memberships: Table<MembershipRow, Record<string, never>, Partial<Pick<MembershipRow, 'role'>>>
      staff_members: Table<
        StaffMemberRow,
        Pick<StaffMemberRow, 'company_id' | 'establishment_id' | 'display_name' | 'job'> &
          Partial<Pick<StaffMemberRow, 'user_id' | 'color' | 'active' | 'jobs' | 'bookable'>>,
        Partial<Pick<StaffMemberRow, 'establishment_id' | 'user_id' | 'display_name' | 'job' | 'jobs' | 'bookable' | 'health_practitioner' | 'color' | 'active'>>
      >
      staff_establishments: Table<StaffEstablishmentRow, Pick<StaffEstablishmentRow, 'staff_id' | 'establishment_id' | 'company_id'>, Record<string, never>>
      staff_working_hours: Table<WorkingHoursRow, Record<string, never>, Record<string, never>>
      staff_time_off: Table<TimeOffRow, Pick<TimeOffRow, 'company_id' | 'staff_id' | 'kind' | 'starts_at' | 'ends_at'>, Record<string, never>>
      invitations: Table<InvitationRow, Record<string, never>, Record<string, never>>
      services: Table<
        ServiceRow,
        Pick<ServiceRow, 'company_id' | 'name' | 'duration_minutes'> & Partial<Pick<ServiceRow, 'price_cents' | 'color' | 'resource_kind' | 'active'>>,
        Partial<Pick<ServiceRow, 'name' | 'duration_minutes' | 'price_cents' | 'color' | 'resource_kind' | 'active'>>
      >
      resources: Table<
        ResourceRow,
        Pick<ResourceRow, 'company_id' | 'establishment_id' | 'name'> & Partial<Pick<ResourceRow, 'kind' | 'active'>>,
        Partial<Pick<ResourceRow, 'name' | 'kind' | 'active'>>
      >
      appointments: Table<AppointmentRow, Record<string, never>, Record<string, never>>
      clients: Table<ClientRow, ClientWritable, Partial<Omit<ClientWritable, 'company_id'>>>
      client_consents: Table<
        ClientConsentRow,
        Pick<ClientConsentRow, 'company_id' | 'client_id' | 'purpose' | 'channel' | 'status'> & Partial<Pick<ClientConsentRow, 'method' | 'wording_version'>>,
        Record<string, never>
      >
      client_technical_notes: Table<TechnicalNoteRow, Pick<TechnicalNoteRow, 'client_id' | 'company_id' | 'kind' | 'content'>, Record<string, never>>
      client_favorite_services: Table<FavoriteServiceRow, Pick<FavoriteServiceRow, 'client_id' | 'service_id' | 'company_id'>, Record<string, never>>
      fiscal_profiles: Table<FiscalProfileRow, Record<string, never>, Partial<Pick<FiscalProfileRow, 'seller_legal_name' | 'seller_tax_id' | 'seller_vat_number' | 'seller_address' | 'legal_mentions' | 'b2c_invoice_threshold_cents'>>>
      tax_rates: Table<TaxRateRow, Record<string, never>, Record<string, never>>
      payment_methods: Table<PaymentMethodRow, Pick<PaymentMethodRow, 'company_id' | 'kind' | 'label'> & Partial<Pick<PaymentMethodRow, 'active' | 'sort'>>, Partial<Pick<PaymentMethodRow, 'label' | 'active' | 'sort'>>>
      products: Table<ProductRow, Pick<ProductRow, 'company_id' | 'name' | 'price_cents'> & Partial<Pick<ProductRow, 'sku' | 'tax_code' | 'active'>>, Partial<Pick<ProductRow, 'name' | 'sku' | 'price_cents' | 'tax_code' | 'active'>>>
      cash_registers: Table<CashRegisterRow, Record<string, never>, Partial<Pick<CashRegisterRow, 'name' | 'active'>>>
      register_sessions: Table<RegisterSessionRow, Record<string, never>, Record<string, never>>
      sales: Table<SaleRow, Record<string, never>, Record<string, never>>
      sale_lines: Table<SaleLineRow, Record<string, never>, Record<string, never>>
      sale_payments: Table<SalePaymentRow, Record<string, never>, Record<string, never>>
      closures: Table<ClosureRow, Record<string, never>, Record<string, never>>
      invoices: Table<InvoiceRow, Record<string, never>, Record<string, never>>
      accounting_accounts: Table<AccountingAccountRow, Record<string, never>, Partial<Pick<AccountingAccountRow, 'account' | 'label'>>>
      export_batches: Table<ExportBatchRow, Record<string, never>, Record<string, never>>
    }
    Views: { [_ in never]: never }
    Functions: {
      create_company_with_establishment: {
        Args: {
          p_company_name: string
          p_establishment_name: string
          p_kind: EstablishmentKind
          p_country_code: string
          p_city: string | null
          p_timezone: string
          p_locale: AppLocale
          p_currency: string
        }
        Returns: string
      }
      my_permissions: { Args: { p_company_id: string }; Returns: Permission[] }
      export_my_data: { Args: never; Returns: unknown }
      delete_company: { Args: { p_company_id: string; p_confirm_name: string }; Returns: undefined }
      delete_my_account: { Args: never; Returns: undefined }
      set_staff_week_schedule: {
        Args: { p_staff_id: string; p_establishment_id: string; p_slots: { weekday: number; start: string; end: string }[] }
        Returns: undefined
      }
      create_invitation: {
        Args: { p_company_id: string; p_email: string; p_role: CompanyRole; p_staff_id?: string | null }
        Returns: { invitation_id: string; token: string; expires_at: string }[]
      }
      get_invitation: {
        Args: { p_token: string }
        Returns: { company_name: string; role: CompanyRole; email: string; expires_at: string; status: 'pending' | 'accepted' | 'expired' | 'revoked' }[]
      }
      accept_invitation: { Args: { p_token: string }; Returns: string }
      revoke_invitation: { Args: { p_invitation_id: string }; Returns: undefined }
      book_appointment: {
        Args: {
          p_establishment_id: string
          p_staff_id: string
          p_service_id: string
          p_start_local: string
          p_client_label?: string | null
          p_resource_id?: string | null
          p_client_id?: string | null
        }
        Returns: string
      }
      reschedule_appointment: {
        Args: {
          p_appointment_id: string
          p_start_local: string
          p_expected_version: number
          p_staff_id?: string | null
          p_service_id?: string | null
          p_resource_id?: string | null
          p_client_label?: string | null
          p_client_id?: string | null
        }
        Returns: number
      }
      cancel_appointment: { Args: { p_appointment_id: string; p_expected_version: number }; Returns: undefined }
      search_clients: {
        Args: {
          p_company_id: string
          p_query?: string
          p_establishment_id?: string | null
          p_tag?: string | null
          p_last_visit?: 'lt1m' | '1to6m' | 'gt6m' | 'never' | null
          p_marketing?: boolean | null
          p_birthday_this_month?: boolean
          p_limit?: number
          p_offset?: number
        }
        Returns: ClientSearchRow[]
      }
      find_duplicate_candidates: {
        Args: { p_company_id: string; p_first_name?: string | null; p_last_name?: string | null; p_email?: string | null; p_phone?: string | null; p_exclude?: string | null }
        Returns: { id: string; first_name: string | null; last_name: string | null; email_masked: string | null; phone_masked: string | null; score: number }[]
      }
      reveal_client_contact: { Args: { p_client_id: string }; Returns: { email: string | null; phone_e164: string | null }[] }
      merge_clients: { Args: { p_keep_id: string; p_merge_id: string; p_take?: Record<string, boolean> }; Returns: string }
      export_client_data: { Args: { p_client_id: string }; Returns: unknown }
      erase_client: { Args: { p_client_id: string; p_confirm: boolean }; Returns: undefined }
      clients_to_review: { Args: { p_company_id: string }; Returns: { id: string; first_name: string | null; last_name: string | null; last_activity: string }[] }
      set_retention_settings: { Args: { p_company_id: string; p_review_months: number; p_accounting_years: number }; Returns: undefined }
      get_client_health_notes: { Args: { p_client_id: string }; Returns: HealthNotes | null }
      set_client_health_notes: { Args: { p_client_id: string; p_notes: HealthNotes }; Returns: undefined }
      can_access_health: { Args: { p_client_id: string }; Returns: boolean }
      set_health_data_enabled: {
        Args: { p_company_id: string; p_enabled: boolean; p_ack_consent?: boolean; p_ack_dpia?: boolean; p_ack_information?: boolean }
        Returns: undefined
      }
      open_register: { Args: { p_register_id: string; p_opening_float_cents: number; p_count?: Record<string, number> | null }; Returns: string }
      add_cash_movement: { Args: { p_session_id: string; p_direction: 'in' | 'out'; p_amount_cents: number; p_reason: string }; Returns: string }
      create_discount_approval: { Args: { p_establishment_id: string; p_max_bp: number }; Returns: { code: string; expires_at: string }[] }
      complete_sale: { Args: { p_payload: CompleteSalePayload }; Returns: CompleteSaleResult }
      refund_sale: {
        Args: { p_payload: { original_sale_id: string; session_id: string; idempotency_key: string; reason: string; lines?: { line_id: string; quantity: number }[]; payments: { method_id: string; amount_cents: number }[] } }
        Returns: { sale_id: string; document_no: string; total_cents: number; replayed: boolean }
      }
      close_register: {
        Args: { p_session_id: string; p_counted_cash_cents: number; p_count?: Record<string, number> | null; p_reason?: string | null }
        Returns: { closure_id: string; document_no: string; expected_cents: number; difference_cents: number }
      }
      close_period: { Args: { p_establishment_id: string; p_kind: 'month' | 'year'; p_period_start: string }; Returns: { closure_id: string; document_no: string } }
      issue_invoice: { Args: { p_sale_id: string; p_buyer: { name: string; address?: string; vat_number?: string; tax_id?: string } }; Returns: { invoice_id: string; document_no: string; replayed: boolean } }
      get_document: { Args: { p_kind: 'receipt' | 'invoice' | 'closure'; p_id: string }; Returns: unknown }
      sales_report: { Args: { p_establishment_id: string; p_from: string; p_to: string }; Returns: SalesReport }
      export_accounting: {
        Args: { p_establishment_id: string; p_from: string; p_to: string; p_format: 'csv' | 'fec' }
        Returns: { format: 'csv' | 'fec'; rows: number; content: string; filename: string }
      }
      verify_integrity: {
        Args: { p_establishment_id: string }
        Returns: { ok: boolean; sales: { documents: number; first_broken: string | null }; closures: { documents: number; first_broken: string | null }; journal: { entries: number; first_broken: number | null } }
      }
      set_discount_caps: { Args: { p_company_id: string; p_staff_bp: number; p_manager_bp: number }; Returns: undefined }
    }
    Enums: {
      company_role: CompanyRole
      establishment_kind: EstablishmentKind
      staff_job: StaffJob
      time_off_kind: TimeOffKind
      resource_kind: ResourceKind
      appointment_status: AppointmentStatus
      client_status: ClientStatus
      consent_purpose: ConsentPurpose
      consent_channel: ConsentChannel
    }
    CompositeTypes: { [_ in never]: never }
  }
}
