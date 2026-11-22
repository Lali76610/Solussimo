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
}

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
        Partial<Pick<StaffMemberRow, 'establishment_id' | 'user_id' | 'display_name' | 'job' | 'jobs' | 'bookable' | 'color' | 'active'>>
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
          p_client_label: string
          p_resource_id?: string | null
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
        }
        Returns: number
      }
      cancel_appointment: { Args: { p_appointment_id: string; p_expected_version: number }; Returns: undefined }
    }
    Enums: {
      company_role: CompanyRole
      establishment_kind: EstablishmentKind
      staff_job: StaffJob
      time_off_kind: TimeOffKind
      resource_kind: ResourceKind
      appointment_status: AppointmentStatus
    }
    CompositeTypes: { [_ in never]: never }
  }
}
