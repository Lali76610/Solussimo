-- =============================================================================
-- SOLUSSIMO — Migration 007 : module Personnel
--  · fonctions multiples, disponibilité à la réservation
--  · affectation à plusieurs établissements (staff_establishments)
--  · horaires hebdomadaires (les pauses = intervalles entre deux plages)
--  · absences et congés (sans motif médical : donnée sensible art. 9 RGPD)
--  · permissions limitées aux établissements affectés (managers / staff)
-- =============================================================================

create extension if not exists btree_gist with schema extensions;

alter type public.staff_job add value if not exists 'nail_technician';

create type public.time_off_kind as enum ('vacation', 'absence', 'training', 'other');

-- --- Collaborateurs : fonctions multiples + réservable --------------------------
alter table public.staff_members
  add column jobs public.staff_job[] not null default '{}',
  add column bookable boolean not null default true,
  add constraint staff_members_id_company_key unique (id, company_id);

update public.staff_members set jobs = array[job] where cardinality(jobs) = 0;

-- Rétrocompatibilité : la fonction principale (job) fait toujours partie de jobs.
create or replace function private.normalize_staff_jobs()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not (new.job = any (coalesce(new.jobs, '{}'))) then
    new.jobs := array_prepend(new.job, coalesce(new.jobs, '{}'));
  end if;
  select coalesce(array_agg(distinct j), '{}') into new.jobs from unnest(new.jobs) as j;
  return new;
end;
$$;

create trigger staff_members_normalize_jobs
  before insert or update of job, jobs on public.staff_members
  for each row execute function private.normalize_staff_jobs();

alter table public.staff_members
  add constraint staff_members_jobs_check
  check (cardinality(jobs) between 1 and 8 and job = any (jobs));

-- --- Affectation à un ou plusieurs établissements ------------------------------
create table public.staff_establishments (
  staff_id         uuid not null,
  establishment_id uuid not null,
  company_id       uuid not null references public.companies (id) on delete cascade,
  created_at       timestamptz not null default now(),
  primary key (staff_id, establishment_id),
  foreign key (staff_id, company_id) references public.staff_members (id, company_id) on delete cascade,
  foreign key (establishment_id, company_id) references public.establishments (id, company_id) on delete cascade
);
create index staff_establishments_establishment_idx on public.staff_establishments (establishment_id, company_id);
create index staff_establishments_company_idx on public.staff_establishments (company_id);

insert into public.staff_establishments (staff_id, establishment_id, company_id)
select id, establishment_id, company_id from public.staff_members
on conflict do nothing;

-- L'établissement principal fait toujours partie des affectations.
create or replace function private.ensure_primary_assignment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.staff_establishments (staff_id, establishment_id, company_id)
  values (new.id, new.establishment_id, new.company_id)
  on conflict do nothing;
  return null;
end;
$$;

create trigger staff_members_primary_assignment
  after insert or update of establishment_id on public.staff_members
  for each row execute function private.ensure_primary_assignment();

-- On ne retire pas l'établissement principal (le changer d'abord).
create or replace function private.protect_primary_assignment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.staff_members s
             where s.id = old.staff_id and s.establishment_id = old.establishment_id) then
    raise exception 'cannot_remove_primary_establishment' using errcode = '23514';
  end if;
  return old;
end;
$$;

create trigger staff_establishments_protect_primary
  before delete on public.staff_establishments
  for each row
  when (pg_trigger_depth() = 0)
  execute function private.protect_primary_assignment();

-- --- Horaires hebdomadaires --------------------------------------------------------
create table public.staff_working_hours (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies (id) on delete cascade,
  staff_id         uuid not null,
  establishment_id uuid not null,
  weekday          smallint not null check (weekday between 1 and 7),  -- ISO : 1 = lundi
  start_time       time not null,
  end_time         time not null,
  created_at       timestamptz not null default now(),
  check (start_time < end_time),
  foreign key (staff_id, company_id) references public.staff_members (id, company_id) on delete cascade,
  foreign key (staff_id, establishment_id) references public.staff_establishments (staff_id, establishment_id) on delete cascade,
  foreign key (establishment_id, company_id) references public.establishments (id, company_id) on delete cascade,
  -- Pas de chevauchement de plages pour un même collaborateur et un même jour.
  constraint staff_working_hours_no_overlap exclude using gist (
    staff_id with =,
    weekday with =,
    int4range((extract(epoch from start_time) / 60)::int, (extract(epoch from end_time) / 60)::int) with &&
  )
);
create index staff_working_hours_company_idx on public.staff_working_hours (company_id);
create index staff_working_hours_establishment_idx on public.staff_working_hours (establishment_id, company_id);
create index staff_working_hours_staff_company_idx on public.staff_working_hours (staff_id, company_id);

-- --- Absences / congés ---------------------------------------------------------
create table public.staff_time_off (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  staff_id   uuid not null,
  kind       public.time_off_kind not null default 'absence',
  starts_at  timestamptz not null,
  ends_at    timestamptz not null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at and ends_at - starts_at <= interval '366 days'),
  foreign key (staff_id, company_id) references public.staff_members (id, company_id) on delete cascade
);
create index staff_time_off_staff_idx on public.staff_time_off (staff_id, company_id, starts_at);
create index staff_time_off_company_idx on public.staff_time_off (company_id);
create index staff_time_off_created_by_idx on public.staff_time_off (created_by);

-- --- Autorisations par établissement ------------------------------------------------

create or replace function private.permission_roles(p_permission text)
returns public.company_role[]
language sql
immutable
set search_path = ''
as $$
  select case p_permission
    when 'company.read'         then array['owner', 'admin', 'manager', 'staff']
    when 'company.update'       then array['owner', 'admin']
    when 'company.delete'       then array['owner']
    when 'establishment.write'  then array['owner', 'admin']
    when 'establishment.delete' then array['owner']
    when 'membership.manage'    then array['owner', 'admin']
    when 'invitation.manage'    then array['owner', 'admin']
    when 'staff.write'          then array['owner', 'admin', 'manager']
    when 'schedule.write'       then array['owner', 'admin', 'manager']
    when 'service.write'        then array['owner', 'admin']
    when 'resource.write'       then array['owner', 'admin']
    when 'appointment.write'    then array['owner', 'admin', 'manager', 'staff']
    when 'audit.read'           then array['owner', 'admin']
    else array[]::text[]
  end::public.company_role[];
$$;

create or replace function public.my_permissions(p_company_id uuid)
returns text[]
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(array_agg(p order by p), array[]::text[])
  from unnest(array[
    'company.read', 'company.update', 'company.delete', 'establishment.write',
    'establishment.delete', 'membership.manage', 'invitation.manage', 'staff.write',
    'schedule.write', 'service.write', 'resource.write', 'appointment.write', 'audit.read'
  ]) as p
  where private.can(p_company_id, p);
$$;

-- Owner / admin : tous les établissements de l'entreprise.
create or replace function private.is_company_admin(p_company_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.has_company_role(p_company_id, array['owner', 'admin']::public.company_role[]);
$$;

-- L'utilisateur courant est-il affecté (fiche active) à cet établissement ?
create or replace function private.is_assigned_to_establishment(p_establishment_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.staff_members s
    join public.staff_establishments se on se.staff_id = s.id
    join public.memberships m on m.company_id = s.company_id and m.user_id = s.user_id
    where s.user_id = (select auth.uid())
      and s.active
      and se.establishment_id = p_establishment_id
  );
$$;

-- Accès en lecture à un établissement : owner/admin, ou affecté.
create or replace function private.can_access_establishment(p_establishment_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.establishments e
    where e.id = p_establishment_id
      and (private.is_company_admin(e.company_id) or private.is_assigned_to_establishment(e.id))
  );
$$;

-- Action soumise à permission, limitée aux établissements affectés pour manager/staff.
create or replace function private.can_in_establishment(p_establishment_id uuid, p_permission text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.establishments e
    where e.id = p_establishment_id
      and private.can(e.company_id, p_permission)
      and (private.is_company_admin(e.company_id) or private.is_assigned_to_establishment(e.id))
  );
$$;

-- Le collaborateur est-il visible par l'utilisateur courant ?
create or replace function private.can_see_staff(p_staff_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.staff_members s
    where s.id = p_staff_id
      and (
        private.is_company_admin(s.company_id)
        or s.user_id = (select auth.uid())
        or exists (select 1 from public.staff_establishments se
                   where se.staff_id = s.id and private.is_assigned_to_establishment(se.establishment_id))
      )
  );
$$;

-- Le collaborateur peut-il être géré (fiche, horaires, absences) par l'utilisateur courant ?
create or replace function private.can_manage_staff(p_staff_id uuid, p_permission text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.staff_members s
    where s.id = p_staff_id
      and private.can(s.company_id, p_permission)
      and (
        private.is_company_admin(s.company_id)
        or exists (select 1 from public.staff_establishments se
                   where se.staff_id = s.id and private.is_assigned_to_establishment(se.establishment_id))
      )
  );
$$;

grant execute on function
  private.is_company_admin(uuid),
  private.is_assigned_to_establishment(uuid),
  private.can_access_establishment(uuid),
  private.can_in_establishment(uuid, text),
  private.can_see_staff(uuid),
  private.can_manage_staff(uuid, text)
to authenticated;

-- --- Politiques : établissements et collaborateurs, désormais cloisonnés par établissement ---

drop policy establishments_select on public.establishments;
create policy establishments_select on public.establishments
  for select to authenticated
  using (private.can_access_establishment(id));

drop policy staff_members_select on public.staff_members;
drop policy staff_members_insert on public.staff_members;
drop policy staff_members_update on public.staff_members;
drop policy staff_members_delete on public.staff_members;

create policy staff_members_select on public.staff_members
  for select to authenticated
  using (private.can_see_staff(id));
create policy staff_members_insert on public.staff_members
  for insert to authenticated
  with check (private.can_in_establishment(establishment_id, 'staff.write'));
create policy staff_members_update on public.staff_members
  for update to authenticated
  using (private.can_manage_staff(id, 'staff.write'))
  with check (private.can_in_establishment(establishment_id, 'staff.write'));
create policy staff_members_delete on public.staff_members
  for delete to authenticated
  using (private.is_company_admin(company_id));

grant insert (jobs, bookable) on public.staff_members to authenticated;
grant update (jobs, bookable) on public.staff_members to authenticated;

-- staff_establishments
alter table public.staff_establishments enable row level security;
revoke all on public.staff_establishments from public, anon, authenticated;
grant select, delete on public.staff_establishments to authenticated;
grant insert (staff_id, establishment_id, company_id) on public.staff_establishments to authenticated;

create policy staff_establishments_select on public.staff_establishments
  for select to authenticated
  using (private.can_see_staff(staff_id));
create policy staff_establishments_insert on public.staff_establishments
  for insert to authenticated
  with check (private.can_manage_staff(staff_id, 'staff.write')
              and private.can_in_establishment(establishment_id, 'staff.write'));
create policy staff_establishments_delete on public.staff_establishments
  for delete to authenticated
  using (private.can_manage_staff(staff_id, 'staff.write')
         and private.can_in_establishment(establishment_id, 'staff.write'));

-- staff_working_hours : lecture par ceux qui voient l'établissement ; écriture via RPC uniquement.
alter table public.staff_working_hours enable row level security;
revoke all on public.staff_working_hours from public, anon, authenticated;
grant select on public.staff_working_hours to authenticated;
create policy staff_working_hours_select on public.staff_working_hours
  for select to authenticated
  using (private.can_access_establishment(establishment_id));

-- staff_time_off
alter table public.staff_time_off enable row level security;
revoke all on public.staff_time_off from public, anon, authenticated;
grant select, delete on public.staff_time_off to authenticated;
grant insert (company_id, staff_id, kind, starts_at, ends_at) on public.staff_time_off to authenticated;

create policy staff_time_off_select on public.staff_time_off
  for select to authenticated
  using (private.can_see_staff(staff_id));
create policy staff_time_off_insert on public.staff_time_off
  for insert to authenticated
  with check (private.can_manage_staff(staff_id, 'schedule.write'));
create policy staff_time_off_delete on public.staff_time_off
  for delete to authenticated
  using (private.can_manage_staff(staff_id, 'schedule.write'));

create or replace function private.set_created_by()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.created_by := (select auth.uid());
  return new;
end;
$$;
create trigger staff_time_off_created_by before insert on public.staff_time_off
  for each row execute function private.set_created_by();

-- --- RPC : remplacement atomique des horaires d'une semaine type --------------------
-- p_slots : [{"weekday":1,"start":"09:00","end":"12:30"}, {"weekday":1,"start":"13:30","end":"19:00"}, …]
create or replace function private.set_staff_week_schedule(p_staff_id uuid, p_establishment_id uuid, p_slots jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  select s.company_id into v_company from public.staff_members s where s.id = p_staff_id;
  if v_company is null
     or not private.can_manage_staff(p_staff_id, 'schedule.write')
     or not private.can_in_establishment(p_establishment_id, 'schedule.write') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not exists (select 1 from public.staff_establishments se
                 where se.staff_id = p_staff_id and se.establishment_id = p_establishment_id) then
    raise exception 'staff_not_assigned' using errcode = '23503';
  end if;
  if jsonb_typeof(p_slots) <> 'array' or jsonb_array_length(p_slots) > 28 then
    raise exception 'invalid_slots' using errcode = '22023';
  end if;

  delete from public.staff_working_hours w
  where w.staff_id = p_staff_id and w.establishment_id = p_establishment_id;

  insert into public.staff_working_hours (company_id, staff_id, establishment_id, weekday, start_time, end_time)
  select v_company, p_staff_id, p_establishment_id,
         (x ->> 'weekday')::smallint, (x ->> 'start')::time, (x ->> 'end')::time
  from jsonb_array_elements(p_slots) as x;
end;
$$;

revoke all on function private.set_staff_week_schedule(uuid, uuid, jsonb) from public, anon;
grant execute on function private.set_staff_week_schedule(uuid, uuid, jsonb) to authenticated;

create function public.set_staff_week_schedule(p_staff_id uuid, p_establishment_id uuid, p_slots jsonb)
returns void
language sql
security invoker
set search_path = ''
as $$
  select private.set_staff_week_schedule(p_staff_id, p_establishment_id, p_slots);
$$;
revoke all on function public.set_staff_week_schedule(uuid, uuid, jsonb) from public, anon;
grant execute on function public.set_staff_week_schedule(uuid, uuid, jsonb) to authenticated;

-- Audit : fonction générique (tables sans colonne id, ex. staff_establishments).
create or replace function private.write_audit_log()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  v_company uuid := (v_row ->> 'company_id')::uuid;
begin
  if not exists (select 1 from public.companies c where c.id = v_company) then
    return null;  -- suppression en cascade d'une entreprise
  end if;
  insert into public.audit_log (company_id, actor_id, action, entity, entity_id)
  values (v_company, (select auth.uid()), lower(tg_op), tg_table_name,
          coalesce(v_row ->> 'id', v_row ->> 'staff_id')::uuid);
  return null;
end;
$$;

-- Audit
create trigger staff_establishments_audit after insert or delete on public.staff_establishments
  for each row execute function private.write_audit_log();
create trigger staff_time_off_audit after insert or delete on public.staff_time_off
  for each row execute function private.write_audit_log();
