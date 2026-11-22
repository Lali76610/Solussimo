-- =============================================================================
-- SOLUSSIMO — Migration 001 : fondations
-- Schéma privé, types énumérés et utilitaires communs.
-- =============================================================================

-- Le schéma « private » n'est PAS exposé par l'API PostgREST de Supabase
-- (seuls les schémas listés dans config.toml [api].schemas le sont).
-- Il contient les fonctions internes utilisées par les politiques RLS.
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;
-- Aucune fonction du schéma privé n'est exécutable par défaut (PUBLIC/anon).
alter default privileges in schema private revoke execute on functions from public;

-- Rôles au sein d'une entreprise (du plus élevé au plus faible).
create type public.company_role as enum ('owner', 'admin', 'manager', 'staff');

-- Types d'établissements.
create type public.establishment_kind as enum (
  'hair_salon', 'beauty_institute', 'barbershop', 'nail_salon', 'spa'
);

-- Métiers des collaborateurs.
create type public.staff_job as enum (
  'manager', 'stylist', 'colorist', 'beautician', 'barber', 'apprentice', 'receptionist'
);

-- Langues prises en charge par l'interface.
create domain public.app_locale as text
  check (value in ('fr', 'en', 'es', 'de'));

-- Mise à jour automatique de updated_at.
create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Interdit de déplacer une ligne d'une entreprise à une autre (isolation multi-tenant).
create or replace function private.prevent_company_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.company_id is distinct from old.company_id then
    raise exception 'company_id is immutable' using errcode = '42501';
  end if;
  return new;
end;
$$;
