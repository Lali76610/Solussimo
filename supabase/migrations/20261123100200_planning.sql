-- =============================================================================
-- SOLUSSIMO — Migration 009 : module Planning
--  · services (prestations : durée, tarif)            · resources (cabines…, préparation)
--  · appointments : écriture UNIQUEMENT via RPC contrôlées côté serveur
--  · anti-double réservation : contraintes d'EXCLUSION (sûres en concurrence)
--  · heures locales converties côté serveur selon le fuseau de l'établissement
--    (gère les changements d'heure ; heures inexistantes refusées)
-- =============================================================================

create type public.resource_kind as enum ('cabin', 'chair', 'equipment');
create type public.appointment_status as enum ('booked', 'completed', 'cancelled', 'no_show');

-- --- Prestations ---------------------------------------------------------------------
create table public.services (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies (id) on delete cascade,
  name             text not null check (char_length(btrim(name)) between 2 and 80),
  duration_minutes integer not null check (duration_minutes between 5 and 600 and duration_minutes % 5 = 0),
  price_cents      integer not null default 0 check (price_cents between 0 and 10000000),
  color            text not null default '#008B8B' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  resource_kind    public.resource_kind,  -- ressource requise (ex. cabine) — préparation V0.4
  active           boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (id, company_id)
);
create index services_company_idx on public.services (company_id);
create trigger services_updated_at before update on public.services
  for each row execute function private.set_updated_at();
create trigger services_company_immutable before update on public.services
  for each row execute function private.prevent_company_change();

-- --- Ressources (cabines de soins, fauteuils, équipements) -------------------------------
create table public.resources (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies (id) on delete cascade,
  establishment_id uuid not null,
  name             text not null check (char_length(btrim(name)) between 1 and 80),
  kind             public.resource_kind not null default 'cabin',
  active           boolean not null default true,
  created_at       timestamptz not null default now(),
  unique (id, company_id),
  unique (id, establishment_id),
  foreign key (establishment_id, company_id) references public.establishments (id, company_id) on delete cascade
);
create index resources_establishment_idx on public.resources (establishment_id, company_id);
create index resources_company_idx on public.resources (company_id);
create trigger resources_company_immutable before update on public.resources
  for each row execute function private.prevent_company_change();

-- --- Rendez-vous ---------------------------------------------------------------------
create table public.appointments (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies (id) on delete cascade,
  establishment_id uuid not null,
  staff_id         uuid not null,
  service_id       uuid not null,
  resource_id      uuid,
  starts_at        timestamptz not null,
  ends_at          timestamptz not null,
  status           public.appointment_status not null default 'booked',
  -- Client : libellé minimal (le module Clients viendra ensuite). Aucune donnée de contact.
  client_label     text not null check (char_length(btrim(client_label)) between 1 and 80),
  price_cents      integer not null check (price_cents >= 0),
  version          integer not null default 1,
  created_by       uuid references auth.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  cancelled_at     timestamptz,
  cancelled_by     uuid references auth.users (id) on delete set null,
  check (ends_at > starts_at and ends_at - starts_at <= interval '12 hours'),
  foreign key (establishment_id, company_id) references public.establishments (id, company_id) on delete cascade,
  foreign key (staff_id, company_id) references public.staff_members (id, company_id) on delete cascade,
  foreign key (service_id, company_id) references public.services (id, company_id) on delete restrict,
  foreign key (resource_id, establishment_id) references public.resources (id, establishment_id) on delete restrict,
  -- ANTI-DOUBLE RÉSERVATION : un collaborateur ne peut avoir deux rendez-vous qui se chevauchent.
  constraint appointments_no_staff_overlap exclude using gist (
    staff_id with =, tstzrange(starts_at, ends_at, '[)') with &&
  ) where (status <> 'cancelled'),
  -- Idem pour une ressource (cabine).
  constraint appointments_no_resource_overlap exclude using gist (
    resource_id with =, tstzrange(starts_at, ends_at, '[)') with &&
  ) where (status <> 'cancelled' and resource_id is not null)
);
create index appointments_establishment_time_idx on public.appointments (establishment_id, starts_at);
create index appointments_company_idx on public.appointments (company_id);
create index appointments_staff_company_idx on public.appointments (staff_id, company_id);
create index appointments_service_company_idx on public.appointments (service_id, company_id);
create index appointments_resource_idx on public.appointments (resource_id, establishment_id);
create index appointments_establishment_company_idx on public.appointments (establishment_id, company_id);
create index appointments_created_by_idx on public.appointments (created_by);
create index appointments_cancelled_by_idx on public.appointments (cancelled_by);
create trigger appointments_updated_at before update on public.appointments
  for each row execute function private.set_updated_at();
create trigger appointments_audit after insert or update on public.appointments
  for each row execute function private.write_audit_log();

-- --- RLS -----------------------------------------------------------------------------
alter table public.services enable row level security;
alter table public.resources enable row level security;
alter table public.appointments enable row level security;

revoke all on public.services, public.resources, public.appointments from public, anon, authenticated;

grant select on public.services to authenticated;
grant insert (company_id, name, duration_minutes, price_cents, color, resource_kind, active) on public.services to authenticated;
grant update (name, duration_minutes, price_cents, color, resource_kind, active) on public.services to authenticated;
create policy services_select on public.services for select to authenticated
  using (private.is_company_member(company_id));
create policy services_insert on public.services for insert to authenticated
  with check (private.can(company_id, 'service.write'));
create policy services_update on public.services for update to authenticated
  using (private.can(company_id, 'service.write')) with check (private.can(company_id, 'service.write'));

grant select on public.resources to authenticated;
grant insert (company_id, establishment_id, name, kind, active) on public.resources to authenticated;
grant update (name, kind, active) on public.resources to authenticated;
create policy resources_select on public.resources for select to authenticated
  using (private.can_access_establishment(establishment_id));
create policy resources_insert on public.resources for insert to authenticated
  with check (private.can_in_establishment(establishment_id, 'resource.write'));
create policy resources_update on public.resources for update to authenticated
  using (private.can_in_establishment(establishment_id, 'resource.write'))
  with check (private.can_in_establishment(establishment_id, 'resource.write'));

-- Rendez-vous : lecture seule via l'API ; toute écriture passe par les RPC ci-dessous.
grant select on public.appointments to authenticated;
create policy appointments_select on public.appointments for select to authenticated
  using (private.can_access_establishment(establishment_id));

-- --- Utilitaires horaires ---------------------------------------------------------------

-- Heure locale (fuseau de l'établissement) → instant UTC. Refuse les heures inexistantes
-- (saut d'heure du printemps) : l'aller-retour doit redonner la même heure locale.
create or replace function private.local_to_utc(p_local timestamp, p_timezone text)
returns timestamptz
language plpgsql
stable
set search_path = ''
as $$
declare
  v_utc timestamptz := p_local at time zone p_timezone;
begin
  if (v_utc at time zone p_timezone) <> p_local then
    raise exception 'invalid_local_time' using errcode = '22008';
  end if;
  return v_utc;
end;
$$;

-- Le créneau est-il entièrement inclus dans une plage de travail du collaborateur ?
create or replace function private.within_working_hours(
  p_staff_id uuid, p_establishment_id uuid, p_start timestamptz, p_end timestamptz, p_timezone text
)
returns boolean
language sql
stable
set search_path = ''
as $$
  with l as (
    select (p_start at time zone p_timezone) as ls, (p_end at time zone p_timezone) as le
  )
  select exists (
    select 1 from public.staff_working_hours w, l
    where w.staff_id = p_staff_id
      and w.establishment_id = p_establishment_id
      and w.weekday = extract(isodow from l.ls)
      and l.ls::date = (l.le - interval '1 microsecond')::date
      and w.start_time <= l.ls::time
      and (l.le::time = '00:00' and w.end_time = '23:59:59' or w.end_time >= l.le::time)
  );
$$;

-- Contrôles communs de réservation (lève une exception explicite en cas de refus).
create or replace function private.check_slot(
  p_company_id uuid, p_establishment_id uuid, p_staff_id uuid, p_service_id uuid, p_resource_id uuid,
  p_start timestamptz, p_end timestamptz, p_timezone text, p_ignore_appointment uuid
)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.staff_members s
    join public.staff_establishments se on se.staff_id = s.id and se.establishment_id = p_establishment_id
    where s.id = p_staff_id and s.company_id = p_company_id and s.active and s.bookable) then
    raise exception 'staff_unavailable' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.services sv
                 where sv.id = p_service_id and sv.company_id = p_company_id and sv.active) then
    raise exception 'service_unavailable' using errcode = 'P0001';
  end if;
  if p_resource_id is not null and not exists (
    select 1 from public.resources r
    where r.id = p_resource_id and r.establishment_id = p_establishment_id and r.active) then
    raise exception 'resource_unavailable' using errcode = 'P0001';
  end if;
  if not private.within_working_hours(p_staff_id, p_establishment_id, p_start, p_end, p_timezone) then
    raise exception 'outside_working_hours' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.staff_time_off t
             where t.staff_id = p_staff_id and tstzrange(t.starts_at, t.ends_at, '[)') && tstzrange(p_start, p_end, '[)')) then
    raise exception 'staff_on_leave' using errcode = 'P0001';
  end if;
  -- Vérification anticipée (message clair) ; la contrainte d'exclusion reste la garantie finale.
  if exists (select 1 from public.appointments a
             where a.staff_id = p_staff_id and a.status <> 'cancelled'
               and a.id is distinct from p_ignore_appointment
               and tstzrange(a.starts_at, a.ends_at, '[)') && tstzrange(p_start, p_end, '[)')) then
    raise exception 'slot_unavailable' using errcode = '23P01';
  end if;
end;
$$;

-- --- RPC : réserver -------------------------------------------------------------------
create or replace function private.book_appointment(
  p_establishment_id uuid, p_staff_id uuid, p_service_id uuid,
  p_start_local timestamp, p_client_label text, p_resource_id uuid
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

  v_start := private.local_to_utc(p_start_local, v_est.timezone);
  v_end := v_start + make_interval(mins => v_service.duration_minutes);

  perform private.check_slot(v_est.company_id, v_est.id, p_staff_id, p_service_id, p_resource_id,
                             v_start, v_end, v_est.timezone, null);
  begin
    insert into public.appointments (company_id, establishment_id, staff_id, service_id, resource_id,
                                     starts_at, ends_at, client_label, price_cents, created_by)
    values (v_est.company_id, v_est.id, p_staff_id, p_service_id, p_resource_id,
            v_start, v_end, btrim(p_client_label), v_service.price_cents, v_user)
    returning id into v_id;
  exception when exclusion_violation then
    -- Demande concurrente arrivée juste avant : le créneau n'est plus libre.
    raise exception 'slot_unavailable' using errcode = '23P01';
  end;
  return v_id;
end;
$$;

-- --- RPC : déplacer / modifier ----------------------------------------------------------
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
    raise exception 'version_conflict' using errcode = '40001';
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

-- --- RPC : annuler --------------------------------------------------------------------
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
    raise exception 'version_conflict' using errcode = '40001';
  end if;
  update public.appointments a
  set status = 'cancelled', cancelled_at = now(), cancelled_by = (select auth.uid()), version = v_appt.version + 1
  where a.id = v_appt.id;
end;
$$;

revoke all on function
  private.local_to_utc(timestamp, text),
  private.within_working_hours(uuid, uuid, timestamptz, timestamptz, text),
  private.check_slot(uuid, uuid, uuid, uuid, uuid, timestamptz, timestamptz, text, uuid),
  private.book_appointment(uuid, uuid, uuid, timestamp, text, uuid),
  private.reschedule_appointment(uuid, timestamp, uuid, uuid, uuid, text, integer),
  private.cancel_appointment(uuid, integer)
from public, anon;
grant execute on function
  private.book_appointment(uuid, uuid, uuid, timestamp, text, uuid),
  private.reschedule_appointment(uuid, timestamp, uuid, uuid, uuid, text, integer),
  private.cancel_appointment(uuid, integer)
to authenticated;

create function public.book_appointment(
  p_establishment_id uuid, p_staff_id uuid, p_service_id uuid,
  p_start_local timestamp, p_client_label text, p_resource_id uuid default null)
returns uuid
language sql security invoker set search_path = ''
as $$ select private.book_appointment(p_establishment_id, p_staff_id, p_service_id, p_start_local, p_client_label, p_resource_id); $$;

create function public.reschedule_appointment(
  p_appointment_id uuid, p_start_local timestamp, p_expected_version integer,
  p_staff_id uuid default null, p_service_id uuid default null,
  p_resource_id uuid default null, p_client_label text default null)
returns integer
language sql security invoker set search_path = ''
as $$ select private.reschedule_appointment(p_appointment_id, p_start_local, p_staff_id, p_service_id, p_resource_id, p_client_label, p_expected_version); $$;

create function public.cancel_appointment(p_appointment_id uuid, p_expected_version integer)
returns void
language sql security invoker set search_path = ''
as $$ select private.cancel_appointment(p_appointment_id, p_expected_version); $$;

revoke all on function
  public.book_appointment(uuid, uuid, uuid, timestamp, text, uuid),
  public.reschedule_appointment(uuid, timestamp, integer, uuid, uuid, uuid, text),
  public.cancel_appointment(uuid, integer)
from public, anon;
grant execute on function
  public.book_appointment(uuid, uuid, uuid, timestamp, text, uuid),
  public.reschedule_appointment(uuid, timestamp, integer, uuid, uuid, uuid, text),
  public.cancel_appointment(uuid, integer)
to authenticated;

-- Filet de sécurité final.
revoke all on all functions in schema private from public, anon;
