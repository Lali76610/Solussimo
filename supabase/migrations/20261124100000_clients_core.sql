-- =============================================================================
-- SOLUSSIMO — Migration 012 : module Clients (socle)
--  · fiches clients (D4 : prénom OU nom ; contacts facultatifs ; D5 : jour/mois)
--  · D2 : e-mail / téléphone NON lisibles via l'API (versions masquées seulement)
--  · préférences, prestations favorites, fiche technique (non sensible)
--  · journal des accès sensibles ; réglages de conservation (D6) ; praticiens (D1)
--  · visibilité par établissement (comme V0.3)
-- =============================================================================

create extension if not exists pg_trgm with schema extensions;
create extension if not exists unaccent with schema extensions;

create type public.client_status as enum ('active', 'archived', 'anonymized');
create type public.time_of_day as enum ('morning', 'afternoon', 'evening');
create type public.technical_note_kind as enum ('color_formula', 'hair', 'skin_type', 'nails', 'other');

-- --- Réglages entreprise : données de santé (D1) et conservation (D6) -------------------
alter table public.companies
  add column health_data_enabled boolean not null default false,
  add column health_data_enabled_at timestamptz,
  add column health_data_enabled_by uuid references auth.users (id) on delete set null,
  add column client_review_months smallint not null default 36 check (client_review_months between 12 and 120),
  add column accounting_retention_years smallint not null default 10 check (accounting_retention_years between 1 and 15);
create index companies_health_enabled_by_idx on public.companies (health_data_enabled_by);

-- Conservation comptable par défaut selon le pays (modifiable ; à valider par le conseil du salon).
create or replace function private.default_accounting_years(p_country text)
returns smallint
language sql immutable set search_path = ''
as $$
  select (case upper(p_country)
    when 'ES' then 6 when 'GB' then 6 when 'IE' then 6
    when 'BE' then 7 when 'AT' then 7
    else 10 end)::smallint;
$$;

create or replace function private.companies_retention_defaults()
returns trigger language plpgsql set search_path = ''
as $$
begin
  new.accounting_retention_years := private.default_accounting_years(new.country_code);
  return new;
end;
$$;
create trigger companies_retention_defaults before insert on public.companies
  for each row execute function private.companies_retention_defaults();
update public.companies set accounting_retention_years = private.default_accounting_years(country_code);

-- --- Praticiens habilités aux données de santé (D1) ----------------------------------
alter table public.staff_members add column health_practitioner boolean not null default false;
grant update (health_practitioner) on public.staff_members to authenticated;

-- Seul un owner/admin peut habiliter (empêche l'auto-habilitation d'un responsable).
create or replace function private.guard_health_practitioner()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if (select auth.uid()) is not null
     and new.health_practitioner is distinct from (case when tg_op = 'UPDATE' then old.health_practitioner else false end)
     and not private.is_company_admin(new.company_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger staff_members_guard_health_practitioner
  before insert or update of health_practitioner on public.staff_members
  for each row execute function private.guard_health_practitioner();

-- --- Permissions (extension de la matrice) -----------------------------------------
create or replace function private.permission_roles(p_permission text)
returns public.company_role[]
language sql immutable set search_path = ''
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
    when 'client.read'          then array['owner', 'admin', 'manager', 'staff']
    when 'client.write'         then array['owner', 'admin', 'manager', 'staff']
    when 'client.contact.read'  then array['owner', 'admin', 'manager']
    when 'client.merge'         then array['owner', 'admin', 'manager']
    when 'client.export'        then array['owner', 'admin']
    when 'client.erase'         then array['owner', 'admin']
    when 'consent.write'        then array['owner', 'admin', 'manager', 'staff']
    when 'settings.health'      then array['owner']
    when 'settings.retention'   then array['owner', 'admin']
    else array[]::text[]
  end::public.company_role[];
$$;

create or replace function public.my_permissions(p_company_id uuid)
returns text[]
language sql stable security invoker set search_path = ''
as $$
  select coalesce(array_agg(p order by p), array[]::text[])
  from unnest(array[
    'company.read', 'company.update', 'company.delete', 'establishment.write',
    'establishment.delete', 'membership.manage', 'invitation.manage', 'staff.write',
    'schedule.write', 'service.write', 'resource.write', 'appointment.write', 'audit.read',
    'client.read', 'client.write', 'client.contact.read', 'client.merge', 'client.export',
    'client.erase', 'consent.write', 'settings.health', 'settings.retention'
  ]) as p
  where private.can(p_company_id, p);
$$;

-- --- Fiches clients -----------------------------------------------------------------
create table public.clients (
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid not null references public.companies (id) on delete cascade,
  home_establishment_id uuid not null,
  first_name            text check (first_name is null or char_length(first_name) between 1 and 60),
  last_name             text check (last_name is null or char_length(last_name) between 1 and 80),
  email                 text check (email is null or (char_length(email) <= 254 and email = lower(email) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  phone_e164            text check (phone_e164 is null or phone_e164 ~ '^\+[1-9][0-9]{6,14}$'),
  -- D2 : seules ces versions masquées sont lisibles directement.
  email_masked          text generated always as (
                          case when email is null then null
                               else left(email, 1) || '•••@' || split_part(email, '@', 2) end) stored,
  phone_masked          text generated always as (
                          case when phone_e164 is null then null
                               else left(phone_e164, 3) || ' •• •• ' || left(right(phone_e164, 4), 2) || ' ' || right(phone_e164, 2) end) stored,
  birthday_month        smallint check (birthday_month between 1 and 12),
  birthday_day          smallint check (birthday_day between 1 and 31),
  preferred_locale      public.app_locale,
  preferred_staff_id    uuid,
  preferred_days        smallint[] not null default '{}' check (preferred_days <@ array[1, 2, 3, 4, 5, 6, 7]::smallint[]),
  preferred_time        public.time_of_day,
  general_note          text check (general_note is null or char_length(general_note) <= 500),
  tags                  text[] not null default '{}' check (cardinality(tags) <= 10),
  status                public.client_status not null default 'active',
  merged_into           uuid references public.clients (id) on delete set null,
  search_text           text not null default '',
  created_by            uuid references auth.users (id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  -- D4 : un prénom OU un nom suffit (sauf fiche anonymisée).
  check (status = 'anonymized' or first_name is not null or last_name is not null),
  check ((birthday_month is null) = (birthday_day is null)),
  unique (id, company_id),
  foreign key (home_establishment_id, company_id) references public.establishments (id, company_id),
  foreign key (preferred_staff_id, company_id) references public.staff_members (id, company_id) on delete set null (preferred_staff_id)
);
create unique index clients_company_email_uidx on public.clients (company_id, email) where email is not null;
create unique index clients_company_phone_uidx on public.clients (company_id, phone_e164) where phone_e164 is not null;
create index clients_search_trgm_idx on public.clients using gin (search_text extensions.gin_trgm_ops);
create index clients_company_name_idx on public.clients (company_id, last_name, first_name);
create index clients_home_establishment_idx on public.clients (home_establishment_id, company_id);
create index clients_preferred_staff_idx on public.clients (preferred_staff_id, company_id);
create index clients_merged_into_idx on public.clients (merged_into);
create index clients_created_by_idx on public.clients (created_by);

-- Normalisation + texte de recherche (sans accents, minuscules, chiffres du téléphone).
create or replace function private.normalize_client()
returns trigger language plpgsql set search_path = ''
as $$
begin
  new.first_name := nullif(btrim(new.first_name), '');
  new.last_name := nullif(btrim(new.last_name), '');
  new.email := nullif(lower(btrim(new.email)), '');
  new.phone_e164 := nullif(regexp_replace(coalesce(new.phone_e164, ''), '[^0-9+]', '', 'g'), '');
  new.general_note := nullif(btrim(new.general_note), '');
  select coalesce(array_agg(distinct btrim(t)) filter (where btrim(t) <> ''), '{}') into new.tags from unnest(new.tags) t;
  new.search_text := lower(extensions.unaccent('extensions.unaccent'::regdictionary, concat_ws(' ',
    new.first_name, new.last_name, new.email, regexp_replace(coalesce(new.phone_e164, ''), '[^0-9]', '', 'g'),
    -- format national (0612…) pour la recherche par numéro local
    case when new.phone_e164 ~ '^\+33' then '0' || substr(new.phone_e164, 4) end)));
  if tg_op = 'INSERT' then
    new.created_by := (select auth.uid());
  end if;
  return new;
end;
$$;
create trigger clients_normalize before insert or update on public.clients
  for each row execute function private.normalize_client();
create trigger clients_updated_at before update on public.clients
  for each row execute function private.set_updated_at();
create trigger clients_company_immutable before update on public.clients
  for each row execute function private.prevent_company_change();
create trigger clients_audit after insert or update on public.clients
  for each row execute function private.write_audit_log();

-- Lien rendez-vous → client (clients de passage : client_id nul + libellé libre).
alter table public.appointments add column client_id uuid;
alter table public.appointments
  add constraint appointments_client_fkey foreign key (client_id, company_id)
  references public.clients (id, company_id) on delete set null (client_id);
create index appointments_client_time_idx on public.appointments (client_id, starts_at desc);
create index appointments_client_company_idx on public.appointments (client_id, company_id);

-- --- Visibilité d'un client --------------------------------------------------------
-- owner/admin : tous ; manager/staff : rattachés à leurs établissements ou venus dans l'un d'eux.
create or replace function private.can_see_client_row(p_company_id uuid, p_home_establishment_id uuid, p_client_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select private.is_company_member(p_company_id) and (
    private.is_company_admin(p_company_id)
    or private.is_assigned_to_establishment(p_home_establishment_id)
    or exists (select 1 from public.appointments a
               where a.client_id = p_client_id and private.is_assigned_to_establishment(a.establishment_id))
  );
$$;

create or replace function private.can_see_client(p_client_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.clients c
                 where c.id = p_client_id
                   and private.can_see_client_row(c.company_id, c.home_establishment_id, c.id));
$$;

create or replace function private.can_write_client(p_client_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.clients c
                 where c.id = p_client_id and c.status = 'active'
                   and private.can(c.company_id, 'client.write')
                   and private.can_see_client_row(c.company_id, c.home_establishment_id, c.id));
$$;

grant execute on function
  private.can_see_client_row(uuid, uuid, uuid), private.can_see_client(uuid), private.can_write_client(uuid)
to authenticated;

-- --- RLS / privilèges -----------------------------------------------------------------
alter table public.clients enable row level security;
revoke all on public.clients from public, anon, authenticated;
-- D2 : email, phone_e164 et search_text ne sont PAS lisibles.
grant select (id, company_id, home_establishment_id, first_name, last_name, email_masked, phone_masked,
              birthday_month, birthday_day, preferred_locale, preferred_staff_id, preferred_days, preferred_time,
              general_note, tags, status, merged_into, created_by, created_at, updated_at)
  on public.clients to authenticated;
grant insert (company_id, home_establishment_id, first_name, last_name, email, phone_e164, birthday_month, birthday_day,
              preferred_locale, preferred_staff_id, preferred_days, preferred_time, general_note, tags)
  on public.clients to authenticated;
grant update (home_establishment_id, first_name, last_name, email, phone_e164, birthday_month, birthday_day,
              preferred_locale, preferred_staff_id, preferred_days, preferred_time, general_note, tags)
  on public.clients to authenticated;

-- Colonnes de la ligne évaluées d'abord (compatible INSERT … RETURNING, leçon V0.3).
create policy clients_select on public.clients for select to authenticated
  using ((status <> 'anonymized' or private.is_company_admin(company_id))
         and private.can_see_client_row(company_id, home_establishment_id, id));
create policy clients_insert on public.clients for insert to authenticated
  with check (private.can_in_establishment(home_establishment_id, 'client.write'));
create policy clients_update on public.clients for update to authenticated
  using (status = 'active' and private.can(company_id, 'client.write')
         and private.can_see_client_row(company_id, home_establishment_id, id))
  with check (private.can(company_id, 'client.write')
              and private.can_see_client_row(company_id, home_establishment_id, id));

-- --- Prestations favorites ------------------------------------------------------------
create table public.client_favorite_services (
  client_id  uuid not null,
  service_id uuid not null,
  company_id uuid not null references public.companies (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (client_id, service_id),
  foreign key (client_id, company_id) references public.clients (id, company_id) on delete cascade,
  foreign key (service_id, company_id) references public.services (id, company_id) on delete cascade
);
create index client_favorite_services_service_idx on public.client_favorite_services (service_id, company_id);
create index client_favorite_services_client_company_idx on public.client_favorite_services (client_id, company_id);
create index client_favorite_services_company_idx on public.client_favorite_services (company_id);
alter table public.client_favorite_services enable row level security;
revoke all on public.client_favorite_services from public, anon, authenticated;
grant select, delete on public.client_favorite_services to authenticated;
grant insert (client_id, service_id, company_id) on public.client_favorite_services to authenticated;
create policy client_favorite_services_select on public.client_favorite_services for select to authenticated
  using (private.can_see_client(client_id));
create policy client_favorite_services_insert on public.client_favorite_services for insert to authenticated
  with check (private.can_write_client(client_id));
create policy client_favorite_services_delete on public.client_favorite_services for delete to authenticated
  using (private.can_write_client(client_id));

-- --- Fiche technique (non sensible : formules de coloration, type de cheveux…) ------------
create table public.client_technical_notes (
  id         uuid primary key default gen_random_uuid(),
  client_id  uuid not null,
  company_id uuid not null references public.companies (id) on delete cascade,
  kind       public.technical_note_kind not null default 'other',
  content    text not null check (char_length(btrim(content)) between 1 and 1000),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (client_id, company_id) references public.clients (id, company_id) on delete cascade
);
create index client_technical_notes_client_idx on public.client_technical_notes (client_id, company_id, created_at desc);
create index client_technical_notes_company_idx on public.client_technical_notes (company_id);
create index client_technical_notes_created_by_idx on public.client_technical_notes (created_by);
create trigger client_technical_notes_created_by before insert on public.client_technical_notes
  for each row execute function private.set_created_by();
alter table public.client_technical_notes enable row level security;
revoke all on public.client_technical_notes from public, anon, authenticated;
grant select, delete on public.client_technical_notes to authenticated;
grant insert (client_id, company_id, kind, content) on public.client_technical_notes to authenticated;
create policy client_technical_notes_select on public.client_technical_notes for select to authenticated
  using (private.can_see_client(client_id));
create policy client_technical_notes_insert on public.client_technical_notes for insert to authenticated
  with check (private.can_write_client(client_id));
create policy client_technical_notes_delete on public.client_technical_notes for delete to authenticated
  using (private.can_write_client(client_id));

-- --- Journal des accès sensibles (sans contenu) ------------------------------------------
create table public.client_access_log (
  id         bigint generated always as identity primary key,
  company_id uuid not null references public.companies (id) on delete cascade,
  client_id  uuid,
  actor_id   uuid,
  action     text not null check (action in ('contact_reveal', 'health_read', 'health_write', 'health_erase',
                                                'export', 'erase', 'merge')),
  created_at timestamptz not null default now()
);
create index client_access_log_company_idx on public.client_access_log (company_id, created_at desc);
create index client_access_log_client_idx on public.client_access_log (client_id);
alter table public.client_access_log enable row level security;
revoke all on public.client_access_log from public, anon, authenticated;
revoke all on sequence public.client_access_log_id_seq from public, anon, authenticated;
grant select on public.client_access_log to authenticated;
create policy client_access_log_select on public.client_access_log for select to authenticated
  using (private.can(company_id, 'audit.read'));

create or replace function private.log_client_access(p_company_id uuid, p_client_id uuid, p_action text)
returns void language sql security definer set search_path = ''
as $$
  insert into public.client_access_log (company_id, client_id, actor_id, action)
  values (p_company_id, p_client_id, (select auth.uid()), p_action);
$$;

revoke all on all functions in schema private from public, anon;
