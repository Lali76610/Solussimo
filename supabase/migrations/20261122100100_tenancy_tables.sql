-- =============================================================================
-- SOLUSSIMO — Migration 002 : structure multi-tenant
-- profiles · companies · establishments · memberships · staff_members
--
-- Principe : chaque donnée métier porte un company_id. L'entreprise
-- (company) est la frontière d'isolation (tenant).
-- RGPD : minimisation — aucune donnée de contact, de santé ou d'identité
-- n'est stockée ici ; l'e-mail reste dans auth.users (géré par Supabase Auth).
-- =============================================================================

-- Profil applicatif d'un utilisateur Supabase Auth (1–1 avec auth.users).
create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(btrim(display_name)) between 1 and 80),
  locale       public.app_locale not null default 'fr',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
comment on table public.profiles is 'Profil minimal (nom affiché, langue). Aucune donnée sensible.';

-- Entreprise cliente de SOLUSSIMO = tenant.
create table public.companies (
  id             uuid primary key default gen_random_uuid(),
  name           text not null check (char_length(btrim(name)) between 2 and 120),
  country_code   text not null check (country_code ~ '^[A-Z]{2}$'),
  default_locale public.app_locale not null default 'fr',
  currency       text not null default 'EUR' check (currency ~ '^[A-Z]{3}$'),
  created_by     uuid references auth.users (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index companies_created_by_idx on public.companies (created_by);
comment on table public.companies is 'Entreprise cliente (tenant). Frontière d''isolation des données.';

-- Établissement (salon, institut…) rattaché à une entreprise.
create table public.establishments (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies (id) on delete cascade,
  name         text not null check (char_length(btrim(name)) between 2 and 120),
  kind         public.establishment_kind not null default 'hair_salon',
  city         text check (city is null or char_length(btrim(city)) between 1 and 120),
  country_code text not null check (country_code ~ '^[A-Z]{2}$'),
  timezone     text not null default 'Europe/Paris' check (char_length(timezone) <= 64),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  -- Permet des clés étrangères composites garantissant l'appartenance au même tenant.
  unique (id, company_id)
);
create index establishments_company_id_idx on public.establishments (company_id);

-- Appartenance d'un utilisateur à une entreprise, avec son rôle.
create table public.memberships (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  role       public.company_role not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, user_id)
);
create index memberships_user_id_idx on public.memberships (user_id);

-- Collaborateurs d'un établissement (peuvent ne pas avoir de compte utilisateur).
create table public.staff_members (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies (id) on delete cascade,
  establishment_id uuid not null,
  user_id          uuid references auth.users (id) on delete set null,
  display_name     text not null check (char_length(btrim(display_name)) between 1 and 80),
  job              public.staff_job not null,
  color            text not null default '#008B8B' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  active           boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  -- L'établissement doit appartenir à la même entreprise que le collaborateur.
  foreign key (establishment_id, company_id)
    references public.establishments (id, company_id) on delete cascade
);
create index staff_members_company_id_idx on public.staff_members (company_id);
create index staff_members_establishment_id_idx on public.staff_members (establishment_id);
create index staff_members_user_id_idx on public.staff_members (user_id);
create unique index staff_members_user_per_company_uidx
  on public.staff_members (company_id, user_id) where user_id is not null;

-- updated_at
create trigger profiles_updated_at before update on public.profiles
  for each row execute function private.set_updated_at();
create trigger companies_updated_at before update on public.companies
  for each row execute function private.set_updated_at();
create trigger establishments_updated_at before update on public.establishments
  for each row execute function private.set_updated_at();
create trigger memberships_updated_at before update on public.memberships
  for each row execute function private.set_updated_at();
create trigger staff_members_updated_at before update on public.staff_members
  for each row execute function private.set_updated_at();

-- company_id immuable
create trigger establishments_company_immutable before update on public.establishments
  for each row execute function private.prevent_company_change();
create trigger memberships_company_immutable before update on public.memberships
  for each row execute function private.prevent_company_change();
create trigger staff_members_company_immutable before update on public.staff_members
  for each row execute function private.prevent_company_change();

-- Création automatique du profil à l'inscription (Supabase Auth).
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name   text := nullif(left(btrim(coalesce(new.raw_user_meta_data ->> 'display_name', '')), 80), '');
  v_locale text := new.raw_user_meta_data ->> 'locale';
begin
  insert into public.profiles (id, display_name, locale)
  values (
    new.id,
    coalesce(v_name, 'Utilisateur'),
    case when v_locale in ('fr', 'en', 'es', 'de') then v_locale else 'fr' end
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();
