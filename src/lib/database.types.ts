/**
 * Types de la base SOLUSSIMO (miroir des migrations supabase/migrations).
 * À régénérer automatiquement une fois le projet Supabase créé :
 *   npx supabase gen types typescript --project-id <id> > src/lib/database.types.ts
 */

export type CompanyRole = 'owner' | 'admin' | 'manager' | 'staff'
export type EstablishmentKind = 'hair_salon' | 'beauty_institute' | 'barbershop' | 'nail_salon' | 'spa'
export type StaffJob = 'manager' | 'stylist' | 'colorist' | 'beautician' | 'barber' | 'apprentice' | 'receptionist'
export type AppLocale = 'fr' | 'en' | 'es' | 'de'
export type Permission =
  | 'company.read'
  | 'company.update'
  | 'company.delete'
  | 'establishment.write'
  | 'establishment.delete'
  | 'membership.manage'
  | 'staff.write'
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
  color: string
  active: boolean
  created_at: string
  updated_at: string
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
          Partial<Pick<StaffMemberRow, 'user_id' | 'color' | 'active'>>,
        Partial<Pick<StaffMemberRow, 'establishment_id' | 'user_id' | 'display_name' | 'job' | 'color' | 'active'>>
      >
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
    }
    Enums: {
      company_role: CompanyRole
      establishment_kind: EstablishmentKind
      staff_job: StaffJob
    }
    CompositeTypes: { [_ in never]: never }
  }
}
