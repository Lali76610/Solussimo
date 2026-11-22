-- =============================================================================
-- SOLUSSIMO — Migration 008 : invitations de collaborateurs
--  · lien à usage unique, valable 72 h
--  · seul le HACHAGE SHA-256 du jeton est stocké (jamais le jeton)
--  · acceptation réservée au compte dont l'e-mail (confirmé) correspond
--  · création/révocation : owner / admin ; un admin n'invite jamais d'admin ni d'owner
-- =============================================================================

create table public.invitations (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id) on delete cascade,
  staff_id    uuid,
  email       text not null check (char_length(email) <= 254 and email = lower(email) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  role        public.company_role not null check (role <> 'owner'),
  token_hash  bytea not null unique,
  expires_at  timestamptz not null,
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  accepted_at timestamptz,
  accepted_by uuid references auth.users (id) on delete set null,
  revoked_at  timestamptz,
  foreign key (staff_id, company_id) references public.staff_members (id, company_id) on delete cascade
);
create index invitations_company_idx on public.invitations (company_id, created_at desc);
create index invitations_staff_idx on public.invitations (staff_id, company_id);
create index invitations_created_by_idx on public.invitations (created_by);
create index invitations_accepted_by_idx on public.invitations (accepted_by);

alter table public.invitations enable row level security;
revoke all on public.invitations from public, anon, authenticated;
-- Lecture sans la colonne token_hash.
grant select (id, company_id, staff_id, email, role, expires_at, created_by, created_at, accepted_at, accepted_by, revoked_at)
  on public.invitations to authenticated;

create policy invitations_select on public.invitations
  for select to authenticated
  using (private.can(company_id, 'invitation.manage'));

create trigger invitations_audit after insert or update on public.invitations
  for each row execute function private.write_audit_log();

-- --- Création ----------------------------------------------------------------------
create or replace function private.create_invitation(
  p_company_id uuid, p_email text, p_role public.company_role, p_staff_id uuid
)
returns table (invitation_id uuid, token text, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_email text := lower(btrim(p_email));
  v_token text := encode(extensions.gen_random_bytes(32), 'hex');
  v_id uuid;
  v_expires timestamptz := now() + interval '72 hours';
begin
  if v_actor is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if not private.can(p_company_id, 'invitation.manage') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_role = 'owner'
     or (p_role = 'admin' and not private.has_company_role(p_company_id, array['owner']::public.company_role[])) then
    raise exception 'forbidden_role' using errcode = '42501';
  end if;
  if p_staff_id is not null and not exists (
    select 1 from public.staff_members s
    where s.id = p_staff_id and s.company_id = p_company_id and s.user_id is null) then
    raise exception 'invalid_staff' using errcode = '22023';
  end if;
  if exists (select 1 from public.memberships m join auth.users u on u.id = m.user_id
             where m.company_id = p_company_id and lower(u.email) = v_email) then
    raise exception 'already_member' using errcode = '23505';
  end if;
  -- Anti-abus : 30 invitations par entreprise et par 24 h.
  if (select count(*) from public.invitations i
      where i.company_id = p_company_id and i.created_at > now() - interval '24 hours') >= 30 then
    raise exception 'invitation_limit_reached' using errcode = 'P0001';
  end if;

  -- Une seule invitation en attente par adresse et par entreprise.
  update public.invitations i set revoked_at = now()
  where i.company_id = p_company_id and i.email = v_email
    and i.accepted_at is null and i.revoked_at is null;

  insert into public.invitations (company_id, staff_id, email, role, token_hash, expires_at, created_by)
  values (p_company_id, p_staff_id, v_email, p_role, sha256(convert_to(v_token, 'UTF8')), v_expires, v_actor)
  returning id into v_id;

  return query select v_id, v_token, v_expires;
end;
$$;

-- --- Consultation (par l'invité connecté, avant acceptation) -----------------------------
create or replace function private.get_invitation(p_token text)
returns table (company_name text, role public.company_role, email text, expires_at timestamptz, status text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  return query
  select c.name, i.role, i.email, i.expires_at,
         case
           when i.revoked_at is not null then 'revoked'
           when i.accepted_at is not null then 'accepted'
           when i.expires_at <= now() then 'expired'
           else 'pending'
         end
  from public.invitations i
  join public.companies c on c.id = i.company_id
  where i.token_hash = sha256(convert_to(coalesce(p_token, ''), 'UTF8'));
end;
$$;

-- --- Acceptation -------------------------------------------------------------------
create or replace function private.accept_invitation(p_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_inv public.invitations%rowtype;
  v_email text;
  v_confirmed timestamptz;
begin
  if v_user is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  -- Verrou de ligne : deux acceptations simultanées du même lien sont sérialisées.
  select * into v_inv from public.invitations i
  where i.token_hash = sha256(convert_to(coalesce(p_token, ''), 'UTF8'))
  for update;

  if not found or v_inv.revoked_at is not null or v_inv.accepted_at is not null or v_inv.expires_at <= now() then
    raise exception 'invitation_invalid' using errcode = '22023';
  end if;

  select lower(u.email), u.email_confirmed_at into v_email, v_confirmed from auth.users u where u.id = v_user;
  if v_email is distinct from v_inv.email or v_confirmed is null then
    raise exception 'invitation_email_mismatch' using errcode = '42501';
  end if;
  if exists (select 1 from public.memberships m where m.company_id = v_inv.company_id and m.user_id = v_user) then
    raise exception 'already_member' using errcode = '23505';
  end if;

  insert into public.memberships (company_id, user_id, role) values (v_inv.company_id, v_user, v_inv.role);

  if v_inv.staff_id is not null then
    update public.staff_members s set user_id = v_user
    where s.id = v_inv.staff_id and s.company_id = v_inv.company_id and s.user_id is null;
  end if;

  update public.invitations i set accepted_at = now(), accepted_by = v_user where i.id = v_inv.id;
  return v_inv.company_id;
end;
$$;

-- --- Révocation --------------------------------------------------------------------
create or replace function private.revoke_invitation(p_invitation_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company uuid;
begin
  select i.company_id into v_company from public.invitations i where i.id = p_invitation_id;
  if v_company is null or not private.can(v_company, 'invitation.manage') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  update public.invitations i set revoked_at = now()
  where i.id = p_invitation_id and i.accepted_at is null and i.revoked_at is null;
end;
$$;

revoke all on function
  private.create_invitation(uuid, text, public.company_role, uuid),
  private.get_invitation(text),
  private.accept_invitation(text),
  private.revoke_invitation(uuid)
from public, anon;
grant execute on function
  private.create_invitation(uuid, text, public.company_role, uuid),
  private.get_invitation(text),
  private.accept_invitation(text),
  private.revoke_invitation(uuid)
to authenticated;

-- Enveloppes exposées par l'API (SECURITY INVOKER).
create function public.create_invitation(p_company_id uuid, p_email text, p_role public.company_role, p_staff_id uuid default null)
returns table (invitation_id uuid, token text, expires_at timestamptz)
language sql security invoker set search_path = ''
as $$ select * from private.create_invitation(p_company_id, p_email, p_role, p_staff_id); $$;

create function public.get_invitation(p_token text)
returns table (company_name text, role public.company_role, email text, expires_at timestamptz, status text)
language sql stable security invoker set search_path = ''
as $$ select * from private.get_invitation(p_token); $$;

create function public.accept_invitation(p_token text)
returns uuid
language sql security invoker set search_path = ''
as $$ select private.accept_invitation(p_token); $$;

create function public.revoke_invitation(p_invitation_id uuid)
returns void
language sql security invoker set search_path = ''
as $$ select private.revoke_invitation(p_invitation_id); $$;

revoke all on function
  public.create_invitation(uuid, text, public.company_role, uuid),
  public.get_invitation(text),
  public.accept_invitation(text),
  public.revoke_invitation(uuid)
from public, anon;
grant execute on function
  public.create_invitation(uuid, text, public.company_role, uuid),
  public.get_invitation(text),
  public.accept_invitation(text),
  public.revoke_invitation(uuid)
to authenticated;
