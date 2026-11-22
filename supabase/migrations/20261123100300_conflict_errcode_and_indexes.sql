-- =============================================================================
-- SOLUSSIMO — Migration 010 : correctifs constatés sur Supabase (test de bout en bout)
--
-- 1) Conflit de version : le code SQLSTATE 40001 (serialization_failure) est
--    RÉESSAYÉ AUTOMATIQUEMENT par PostgREST ; un conflit permanent bouclait alors
--    jusqu'au délai d'expiration (HTTP 504). Le conflit est désormais signalé par
--    une erreur métier (P0001, message « version_conflict »), jamais réessayée.
-- 2) Index couvrant des clés étrangères composites (Performance Advisor).
-- =============================================================================

create or replace function private.reschedule_appointment(
  p_appointment_id uuid, p_start_local timestamp, p_staff_id uuid, p_service_id uuid,
  p_resource_id uuid, p_client_label text, p_expected_version integer
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_appt public.appointments%rowtype;
  v_est public.establishments%rowtype;
  v_service public.services%rowtype;
  v_start timestamptz;
  v_end timestamptz;
begin
  if (select auth.uid()) is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  select * into v_appt from public.appointments a where a.id = p_appointment_id for update;
  if not found or not private.can_in_establishment(v_appt.establishment_id, 'appointment.write') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_appt.status <> 'booked' then
    raise exception 'appointment_not_editable' using errcode = 'P0001';
  end if;
  -- Concurrence optimiste : refuse si quelqu'un a modifié le rendez-vous entre-temps.
  if p_expected_version is distinct from v_appt.version then
    raise exception 'version_conflict' using errcode = 'P0001';
  end if;

  select * into v_est from public.establishments e where e.id = v_appt.establishment_id;
  select * into v_service from public.services s
  where s.id = coalesce(p_service_id, v_appt.service_id) and s.company_id = v_appt.company_id;
  if not found then
    raise exception 'service_unavailable' using errcode = 'P0001';
  end if;

  v_start := private.local_to_utc(p_start_local, v_est.timezone);
  v_end := v_start + make_interval(mins => v_service.duration_minutes);

  perform private.check_slot(v_appt.company_id, v_appt.establishment_id, coalesce(p_staff_id, v_appt.staff_id),
                             v_service.id, p_resource_id, v_start, v_end, v_est.timezone, v_appt.id);
  begin
    update public.appointments a set
      starts_at = v_start,
      ends_at = v_end,
      staff_id = coalesce(p_staff_id, v_appt.staff_id),
      service_id = v_service.id,
      resource_id = p_resource_id,
      client_label = coalesce(nullif(btrim(p_client_label), ''), v_appt.client_label),
      price_cents = case when v_service.id = v_appt.service_id then v_appt.price_cents else v_service.price_cents end,
      version = v_appt.version + 1
    where a.id = v_appt.id;
  exception when exclusion_violation then
    raise exception 'slot_unavailable' using errcode = '23P01';
  end;
  return v_appt.version + 1;
end;
$$;

create or replace function private.cancel_appointment(p_appointment_id uuid, p_expected_version integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_appt public.appointments%rowtype;
begin
  if (select auth.uid()) is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  select * into v_appt from public.appointments a where a.id = p_appointment_id for update;
  if not found or not private.can_in_establishment(v_appt.establishment_id, 'appointment.write') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_appt.status <> 'booked' then
    raise exception 'appointment_not_editable' using errcode = 'P0001';
  end if;
  if p_expected_version is distinct from v_appt.version then
    raise exception 'version_conflict' using errcode = 'P0001';
  end if;
  update public.appointments a
  set status = 'cancelled', cancelled_at = now(), cancelled_by = (select auth.uid()), version = v_appt.version + 1
  where a.id = v_appt.id;
end;
$$;

create index if not exists staff_establishments_staff_company_idx
  on public.staff_establishments (staff_id, company_id);
create index if not exists staff_working_hours_staff_establishment_idx
  on public.staff_working_hours (staff_id, establishment_id);
