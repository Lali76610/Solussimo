-- =============================================================================
-- SOLUSSIMO — Migration 005 : fonctions RPC
--  · create_company_with_establishment : création d'un salon + owner (atomique)
--  · export_my_data                    : droit d'accès / portabilité (art. 15 & 20)
--  · delete_company                    : effacement d'un tenant par son owner
--  · delete_my_account                 : droit à l'effacement (art. 17)
-- Toutes refusent les appels anonymes et ne sont pas exécutables par « anon ».
-- =============================================================================

create or replace function public.create_company_with_establishment(
  p_company_name       text,
  p_establishment_name text,
  p_kind               public.establishment_kind,
  p_country_code       text,
  p_city               text,
  p_timezone           text,
  p_locale             text,
  p_currency           text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user          uuid := (select auth.uid());
  v_company_id    uuid;
  v_establishment uuid;
  v_display_name  text;
begin
  if v_user is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  -- Limite anti-abus : 5 entreprises créées par compte.
  if (select count(*) from public.companies c where c.created_by = v_user) >= 5 then
    raise exception 'company_limit_reached' using errcode = 'P0001';
  end if;

  if not exists (select 1 from pg_catalog.pg_timezone_names t where t.name = p_timezone) then
    raise exception 'invalid_timezone' using errcode = '22023';
  end if;

  insert into public.companies (name, country_code, default_locale, currency, created_by)
  values (btrim(p_company_name), upper(p_country_code), p_locale, upper(p_currency), v_user)
  returning id into v_company_id;

  insert into public.establishments (company_id, name, kind, city, country_code, timezone)
  values (v_company_id, btrim(p_establishment_name), p_kind, nullif(btrim(p_city), ''),
          upper(p_country_code), p_timezone)
  returning id into v_establishment;

  -- Association du propriétaire.
  insert into public.memberships (company_id, user_id, role)
  values (v_company_id, v_user, 'owner');

  -- Le propriétaire apparaît dans l'équipe de son établissement.
  select p.display_name into v_display_name from public.profiles p where p.id = v_user;
  insert into public.staff_members (company_id, establishment_id, user_id, display_name, job)
  values (v_company_id, v_establishment, v_user, coalesce(v_display_name, 'Owner'), 'manager');

  return v_company_id;
end;
$$;

create or replace function public.export_my_data()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
begin
  if v_user is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  return jsonb_build_object(
    'exported_at', now(),
    'user_id', v_user,
    'email', (select u.email from auth.users u where u.id = v_user),
    'profile', (select to_jsonb(p) from public.profiles p where p.id = v_user),
    'memberships', coalesce((
      select jsonb_agg(jsonb_build_object(
        'company', c.name, 'role', m.role, 'since', m.created_at))
      from public.memberships m join public.companies c on c.id = m.company_id
      where m.user_id = v_user), '[]'::jsonb),
    'staff_records', coalesce((
      select jsonb_agg(jsonb_build_object(
        'company', c.name, 'display_name', s.display_name, 'job', s.job, 'active', s.active))
      from public.staff_members s join public.companies c on c.id = s.company_id
      where s.user_id = v_user), '[]'::jsonb)
  );
end;
$$;

create or replace function public.delete_company(p_company_id uuid, p_confirm_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
begin
  if (select auth.uid()) is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if not private.can(p_company_id, 'company.delete') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select c.name into v_name from public.companies c where c.id = p_company_id;
  if v_name is distinct from p_confirm_name then
    raise exception 'confirmation_mismatch' using errcode = '22023';
  end if;
  delete from public.companies c where c.id = p_company_id;
end;
$$;

create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
begin
  if v_user is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  -- Interdit d'abandonner une entreprise sans owner : transférer ou supprimer d'abord.
  if exists (
    select 1 from public.memberships m
    where m.user_id = v_user and m.role = 'owner'
      and not exists (
        select 1 from public.memberships o
        where o.company_id = m.company_id and o.role = 'owner' and o.user_id <> v_user)
  ) then
    raise exception 'sole_owner_of_company' using errcode = 'P0001';
  end if;

  -- Cascade : profil et adhésions supprimés ; fiches collaborateur dissociées.
  delete from auth.users u where u.id = v_user;
end;
$$;

revoke all on function
  public.create_company_with_establishment(text, text, public.establishment_kind, text, text, text, text, text),
  public.export_my_data(),
  public.delete_company(uuid, text),
  public.delete_my_account()
from public, anon;

grant execute on function
  public.create_company_with_establishment(text, text, public.establishment_kind, text, text, text, text, text),
  public.export_my_data(),
  public.delete_company(uuid, text),
  public.delete_my_account()
to authenticated;

-- Filet de sécurité : aucune fonction interne exécutable par PUBLIC / anon.
revoke all on all functions in schema private from public, anon;
