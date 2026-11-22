-- =============================================================================
-- SOLUSSIMO — Migration 015 : rendez-vous ↔ fiches clients
--  · book / reschedule acceptent une fiche client (p_client_id), contrôlée côté serveur
--  · clients de passage (D4) : pas de fiche, libellé libre (comportement V0.3 inchangé)
--  · règles V0.3 conservées à l'identique (anti-double réservation, fuseaux, versions)
-- =============================================================================

-- Libellé affiché : celui saisi, sinon « Prénom N. » de la fiche ; la fiche doit être
-- active, de la même entreprise et visible par l'utilisateur.
create or replace function private.resolve_client_label(p_company_id uuid, p_client_id uuid, p_label text)
returns text language plpgsql stable security definer set search_path = ''
as $$
declare
  v_client public.clients%rowtype;
begin
  if p_client_id is null then
    if nullif(btrim(p_label), '') is null then
      raise exception 'client_required' using errcode = '22023';
    end if;
    return btrim(p_label);
  end if;
  select * into v_client from public.clients c where c.id = p_client_id;
  if not found or v_client.company_id <> p_company_id or v_client.status <> 'active'
     or not private.can_see_client_row(v_client.company_id, v_client.home_establishment_id, v_client.id) then
    raise exception 'client_unavailable' using errcode = 'P0001';
  end if;
  return left(coalesce(nullif(btrim(p_label), ''),
                       concat_ws(' ', v_client.first_name, left(v_client.last_name, 1) || '.')), 80);
end;
$$;

drop function public.book_appointment(uuid, uuid, uuid, timestamp, text, uuid);
drop function public.reschedule_appointment(uuid, timestamp, integer, uuid, uuid, uuid, text);
drop function private.book_appointment(uuid, uuid, uuid, timestamp, text, uuid);
drop function private.reschedule_appointment(uuid, timestamp, uuid, uuid, uuid, text, integer);

create or replace function private.book_appointment(
  p_establishment_id uuid, p_staff_id uuid, p_service_id uuid,
  p_start_local timestamp, p_client_label text, p_resource_id uuid, p_client_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_est public.establishments%rowtype;
  v_service public.services%rowtype;
  v_start timestamptz;
  v_end timestamptz;
  v_id uuid;
  v_label text;
begin
  if v_user is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  select * into v_est from public.establishments e where e.id = p_establishment_id;
  if not found or not private.can_in_establishment(p_establishment_id, 'appointment.write') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select * into v_service from public.services s where s.id = p_service_id and s.company_id = v_est.company_id;
  if not found then
    raise exception 'service_unavailable' using errcode = 'P0001';
  end if;

  v_label := private.resolve_client_label(v_est.company_id, p_client_id, p_client_label);

  v_start := private.local_to_utc(p_start_local, v_est.timezone);
  v_end := v_start + make_interval(mins => v_service.duration_minutes);

  perform private.check_slot(v_est.company_id, v_est.id, p_staff_id, p_service_id, p_resource_id,
                             v_start, v_end, v_est.timezone, null);
  begin
    insert into public.appointments (company_id, establishment_id, staff_id, service_id, resource_id,
                                     starts_at, ends_at, client_label, client_id, price_cents, created_by)
    values (v_est.company_id, v_est.id, p_staff_id, p_service_id, p_resource_id,
            v_start, v_end, v_label, p_client_id, v_service.price_cents, v_user)
    returning id into v_id;
  exception when exclusion_violation then
    -- Demande concurrente arrivée juste avant : le créneau n'est plus libre.
    raise exception 'slot_unavailable' using errcode = '23P01';
  end;
  return v_id;
end;
$$;

create or replace function private.reschedule_appointment(
  p_appointment_id uuid, p_start_local timestamp, p_staff_id uuid, p_service_id uuid,
  p_resource_id uuid, p_client_label text, p_expected_version integer, p_client_id uuid
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
  v_client uuid;
  v_label text;
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

  -- Client : inchangé si non fourni ; sinon contrôlé (même entreprise, visible).
  v_client := coalesce(p_client_id, v_appt.client_id);
  v_label := case
    when p_client_id is not null or nullif(btrim(p_client_label), '') is not null
      then private.resolve_client_label(v_appt.company_id, p_client_id, coalesce(nullif(btrim(p_client_label), ''), case when p_client_id is null then v_appt.client_label end))
    else v_appt.client_label end;

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
      client_label = v_label,
      client_id = v_client,
      price_cents = case when v_service.id = v_appt.service_id then v_appt.price_cents else v_service.price_cents end,
      version = v_appt.version + 1
    where a.id = v_appt.id;
  exception when exclusion_violation then
    raise exception 'slot_unavailable' using errcode = '23P01';
  end;
  return v_appt.version + 1;
end;
$$;

revoke all on function
  private.resolve_client_label(uuid, uuid, text),
  private.book_appointment(uuid, uuid, uuid, timestamp, text, uuid, uuid),
  private.reschedule_appointment(uuid, timestamp, uuid, uuid, uuid, text, integer, uuid)
from public, anon;
grant execute on function
  private.book_appointment(uuid, uuid, uuid, timestamp, text, uuid, uuid),
  private.reschedule_appointment(uuid, timestamp, uuid, uuid, uuid, text, integer, uuid)
to authenticated;

create function public.book_appointment(
  p_establishment_id uuid, p_staff_id uuid, p_service_id uuid,
  p_start_local timestamp, p_client_label text default null, p_resource_id uuid default null, p_client_id uuid default null)
returns uuid
language sql security invoker set search_path = ''
as $$ select private.book_appointment(p_establishment_id, p_staff_id, p_service_id, p_start_local, p_client_label, p_resource_id, p_client_id); $$;

create function public.reschedule_appointment(
  p_appointment_id uuid, p_start_local timestamp, p_expected_version integer,
  p_staff_id uuid default null, p_service_id uuid default null,
  p_resource_id uuid default null, p_client_label text default null, p_client_id uuid default null)
returns integer
language sql security invoker set search_path = ''
as $$ select private.reschedule_appointment(p_appointment_id, p_start_local, p_staff_id, p_service_id, p_resource_id, p_client_label, p_expected_version, p_client_id); $$;

revoke all on function
  public.book_appointment(uuid, uuid, uuid, timestamp, text, uuid, uuid),
  public.reschedule_appointment(uuid, timestamp, integer, uuid, uuid, uuid, text, uuid)
from public, anon;
grant execute on function
  public.book_appointment(uuid, uuid, uuid, timestamp, text, uuid, uuid),
  public.reschedule_appointment(uuid, timestamp, integer, uuid, uuid, uuid, text, uuid)
to authenticated;

revoke all on all functions in schema private from public, anon;
