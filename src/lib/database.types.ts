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
