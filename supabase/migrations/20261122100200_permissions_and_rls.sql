-- =============================================================================
-- SOLUSSIMO — Migration 003 : permissions & Row Level Security
--
-- Règle d'or : un utilisateur ne voit et ne modifie QUE les données des
-- entreprises dont il est membre (table memberships). Aucune politique ne
-- s'applique au rôle « anon » : un visiteur non connecté ne voit rien.
--
-- Matrice des permissions (du rôle le plus élevé au plus faible) :
--
--   permission            owner admin manager staff
--   company.read            ✔     ✔      ✔      ✔
--   company.update          ✔     ✔
--   company.delete          ✔
--   establishment.write     ✔     ✔
--   establishment.delete    ✔
--   membership.manage       ✔     ✔            (rôles/retrait ; un admin ne touche jamais à un owner)
--   staff.write             ✔     ✔      ✔
--   audit.read              ✔     ✔
-- =============================================================================

-- --- Fonctions d'autorisation ------------------------------------------------
-- SECURITY DEFINER : elles lisent memberships sans repasser par sa propre RLS
-- (évite toute récursion). search_path vide : protection contre le détournement
-- de fonctions par un objet homonyme.

create or replace function private.has_company_role(p_company_id uuid, p_roles public.company_role[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships m
    where m.company_id = p_company_id
      and m.user_id = (select auth.uid())
      and m.role = any (p_roles)
  );
$$;

create or replace function private.is_company_member(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships m
    where m.company_id = p_company_id
      and m.user_id = (select auth.uid())
  );
$$;

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
    when 'staff.write'          then array['owner', 'admin', 'manager']
    when 'audit.read'           then array['owner', 'admin']
    else array[]::text[]  -- permission inconnue : refus par défaut
  end::public.company_role[];
$$;

create or replace function private.can(p_company_id uuid, p_permission text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.has_company_role(p_company_id, private.permission_roles(p_permission));
$$;

-- Deux utilisateurs partagent-ils au moins une entreprise ?
create or replace function private.shares_company_with(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships mine
    join public.memberships theirs on theirs.company_id = mine.company_id
    where mine.user_id = (select auth.uid())
      and theirs.user_id = p_user_id
  );
$$;

revoke all on all functions in schema private from public;
grant execute on function
  private.has_company_role(uuid, public.company_role[]),
  private.is_company_member(uuid),
  private.permission_roles(text),
  private.can(uuid, text),
  private.shares_company_with(uuid)
to authenticated;

-- Exposé à l'interface : permissions effectives de l'utilisateur courant.
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
    'establishment.delete', 'membership.manage', 'staff.write', 'audit.read'
  ]) as p
  where private.can(p_company_id, p);
$$;

-- --- Garde-fous sur les adhésions ---------------------------------------------

create or replace function private.guard_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_company uuid := coalesce(new.company_id, old.company_id);
  v_actor_is_owner boolean;
begin
  -- Appels internes (fonctions SECURITY DEFINER, service_role) : pas d'acteur.
  if v_actor is null then
    return coalesce(new, old);
  end if;

  if tg_op = 'UPDATE' and new.user_id is distinct from old.user_id then
    raise exception 'membership user_id is immutable' using errcode = '42501';
  end if;

  -- Amorçage : le créateur d'une entreprise encore sans membre en devient le premier owner.
  if tg_op = 'INSERT' and new.role = 'owner' and new.user_id = v_actor
     and not exists (select 1 from public.memberships m where m.company_id = v_company)
     and exists (select 1 from public.companies c where c.id = v_company and c.created_by = v_actor) then
    return new;
  end if;

  v_actor_is_owner := private.has_company_role(v_company, array['owner']::public.company_role[]);

  -- Seul un owner peut créer, modifier ou retirer un owner.
  if (tg_op in ('INSERT', 'UPDATE') and new.role = 'owner' and not v_actor_is_owner)
     or (tg_op in ('UPDATE', 'DELETE') and old.role = 'owner' and not v_actor_is_owner) then
    raise exception 'only an owner can manage owners' using errcode = '42501';
  end if;

  -- Personne ne modifie son propre rôle (anti-escalade), sauf un owner qui se rétrograde.
  if tg_op = 'UPDATE' and old.user_id = v_actor and not v_actor_is_owner then
    raise exception 'cannot change your own role' using errcode = '42501';
  end if;

  return coalesce(new, old);
end;
$$;

create trigger memberships_guard
  before insert or update or delete on public.memberships
  for each row execute function private.guard_membership();

-- Une entreprise doit toujours conserver au moins un owner.
create or replace function private.ensure_company_has_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.companies c where c.id = old.company_id)
     and not exists (
       select 1 from public.memberships m
       where m.company_id = old.company_id and m.role = 'owner'
     ) then
    raise exception 'a company must keep at least one owner' using errcode = '23514';
  end if;
  return null;
end;
$$;

create constraint trigger memberships_keep_owner
  after update or delete on public.memberships
  deferrable initially immediate
  for each row execute function private.ensure_company_has_owner();

-- Un collaborateur lié à un compte doit être membre de la même entreprise.
create or replace function private.check_staff_user_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.user_id is not null and not exists (
    select 1 from public.memberships m
    where m.company_id = new.company_id and m.user_id = new.user_id
  ) then
    raise exception 'staff user must be a member of the company' using errcode = '23503';
  end if;
  return new;
end;
$$;

create trigger staff_members_user_membership
  before insert or update of user_id, company_id on public.staff_members
  for each row execute function private.check_staff_user_membership();

-- --- Activation de la RLS -----------------------------------------------------

alter table public.profiles       enable row level security;
alter table public.companies      enable row level security;
alter table public.establishments enable row level security;
alter table public.memberships    enable row level security;
alter table public.staff_members  enable row level security;

-- Pas de FORCE ROW LEVEL SECURITY : les fonctions SECURITY DEFINER internes
-- (propriétaire des tables) doivent pouvoir lire memberships sans récursion.
-- La RLS s'applique pleinement aux rôles anon et authenticated de l'API.

-- --- Privilèges (le moindre privilège, colonne par colonne si nécessaire) -----

revoke all on public.profiles, public.companies, public.establishments,
              public.memberships, public.staff_members
  from public, anon, authenticated;

grant select on public.profiles to authenticated;
grant update (display_name, locale) on public.profiles to authenticated;

grant select on public.companies to authenticated;
grant update (name, country_code, default_locale, currency) on public.companies to authenticated;

grant select, delete on public.establishments to authenticated;
grant insert (company_id, name, kind, city, country_code, timezone) on public.establishments to authenticated;
grant update (name, kind, city, country_code, timezone) on public.establishments to authenticated;

-- Pas d'INSERT direct : une adhésion naît uniquement via des fonctions contrôlées
-- (create_company_with_establishment, puis le futur flux d'invitation avec acceptation).
-- Empêche un admin de rattacher un compte tiers à son entreprise à son insu.
grant select, delete on public.memberships to authenticated;
grant update (role) on public.memberships to authenticated;

grant select, delete on public.staff_members to authenticated;
grant insert (company_id, establishment_id, user_id, display_name, job, color, active)
  on public.staff_members to authenticated;
grant update (establishment_id, user_id, display_name, job, color, active)
  on public.staff_members to authenticated;

-- --- Politiques ---------------------------------------------------------------

-- profiles : soi-même + collègues des mêmes entreprises ; modification de soi uniquement.
create policy profiles_select on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or private.shares_company_with(id));
create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- companies : création uniquement via la fonction create_company_with_establishment().
create policy companies_select on public.companies
  for select to authenticated
  using (private.is_company_member(id));
create policy companies_update on public.companies
  for update to authenticated
  using (private.can(id, 'company.update'))
  with check (private.can(id, 'company.update'));

-- establishments
create policy establishments_select on public.establishments
  for select to authenticated
  using (private.is_company_member(company_id));
create policy establishments_insert on public.establishments
  for insert to authenticated
  with check (private.can(company_id, 'establishment.write'));
create policy establishments_update on public.establishments
  for update to authenticated
  using (private.can(company_id, 'establishment.write'))
  with check (private.can(company_id, 'establishment.write'));
create policy establishments_delete on public.establishments
  for delete to authenticated
  using (private.can(company_id, 'establishment.delete'));

-- memberships
create policy memberships_select on public.memberships
  for select to authenticated
  using (private.is_company_member(company_id));
create policy memberships_update on public.memberships
  for update to authenticated
  using (private.can(company_id, 'membership.manage'))
  with check (private.can(company_id, 'membership.manage'));
create policy memberships_delete on public.memberships
  for delete to authenticated
  using (private.can(company_id, 'membership.manage') or user_id = (select auth.uid()));

-- staff_members
create policy staff_members_select on public.staff_members
  for select to authenticated
  using (private.is_company_member(company_id));
create policy staff_members_insert on public.staff_members
  for insert to authenticated
  with check (private.can(company_id, 'staff.write'));
create policy staff_members_update on public.staff_members
  for update to authenticated
  using (private.can(company_id, 'staff.write'))
  with check (private.can(company_id, 'staff.write'));
create policy staff_members_delete on public.staff_members
  for delete to authenticated
  using (private.can(company_id, 'staff.write'));

revoke all on function public.my_permissions(uuid) from public, anon;
grant execute on function public.my_permissions(uuid) to authenticated;
