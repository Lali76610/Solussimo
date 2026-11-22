-- =============================================================================
-- SOLUSSIMO — Migration 006 : durcissement de l'exposition des RPC
--
-- Recommandation du Security Advisor Supabase : ne pas exposer directement
-- des fonctions SECURITY DEFINER via l'API REST.
--  · Les implémentations privilégiées sont déplacées dans le schéma « private »
--    (non exposé par PostgREST).
--  · L'API n'expose plus que des enveloppes SECURITY INVOKER sans logique.
-- Le comportement et les contrôles (auth.uid(), permissions) sont inchangés.
-- =============================================================================

alter function public.create_company_with_establishment(text, text, public.establishment_kind, text, text, text, text, text)
  set schema private;
alter function public.export_my_data() set schema private;
alter function public.delete_company(uuid, text) set schema private;
alter function public.delete_my_account() set schema private;

-- Les implémentations restent appelables par « authenticated » (via les enveloppes),
-- jamais par PUBLIC / anon.
revoke all on function
  private.create_company_with_establishment(text, text, public.establishment_kind, text, text, text, text, text),
  private.export_my_data(),
  private.delete_company(uuid, text),
  private.delete_my_account()
from public, anon;
grant execute on function
  private.create_company_with_establishment(text, text, public.establishment_kind, text, text, text, text, text),
  private.export_my_data(),
  private.delete_company(uuid, text),
  private.delete_my_account()
to authenticated;

-- Enveloppes publiques (mêmes signatures que précédemment : aucun changement côté application).
create function public.create_company_with_establishment(
  p_company_name text, p_establishment_name text, p_kind public.establishment_kind,
  p_country_code text, p_city text, p_timezone text, p_locale text, p_currency text
)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select private.create_company_with_establishment(
    p_company_name, p_establishment_name, p_kind, p_country_code, p_city, p_timezone, p_locale, p_currency);
$$;

create function public.export_my_data()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select private.export_my_data();
$$;

create function public.delete_company(p_company_id uuid, p_confirm_name text)
returns void
language sql
security invoker
set search_path = ''
as $$
  select private.delete_company(p_company_id, p_confirm_name);
$$;

create function public.delete_my_account()
returns void
language sql
security invoker
set search_path = ''
as $$
  select private.delete_my_account();
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

-- Performance : index couvrant la clé étrangère composite (Performance Advisor).
create index if not exists staff_members_establishment_company_idx
  on public.staff_members (establishment_id, company_id);
