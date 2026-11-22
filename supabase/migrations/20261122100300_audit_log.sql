-- =============================================================================
-- SOLUSSIMO — Migration 004 : journal d'audit (RGPD, principe de responsabilité)
--
-- Trace QUI a fait QUOI sur QUELLE entité, sans copier de données personnelles
-- (pas de valeurs avant/après). Lecture réservée aux owners / admins.
-- Aucune écriture directe possible : alimenté uniquement par des triggers.
-- =============================================================================

create table public.audit_log (
  id         bigint generated always as identity primary key,
  company_id uuid not null references public.companies (id) on delete cascade,
  actor_id   uuid,
  action     text not null check (action in ('insert', 'update', 'delete')),
  entity     text not null,
  entity_id  uuid,
  created_at timestamptz not null default now()
);
create index audit_log_company_created_idx on public.audit_log (company_id, created_at desc);

create or replace function private.write_audit_log()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company uuid;
  v_entity_id uuid;
begin
  if tg_op = 'DELETE' then
    v_company := old.company_id;
    v_entity_id := old.id;
  else
    v_company := new.company_id;
    v_entity_id := new.id;
  end if;

  -- Suppression en cascade d'une entreprise : rien à journaliser.
  if not exists (select 1 from public.companies c where c.id = v_company) then
    return null;
  end if;

  insert into public.audit_log (company_id, actor_id, action, entity, entity_id)
  values (v_company, (select auth.uid()), lower(tg_op), tg_table_name, v_entity_id);
  return null;
end;
$$;

create trigger establishments_audit after insert or update or delete on public.establishments
  for each row execute function private.write_audit_log();
create trigger memberships_audit after insert or update or delete on public.memberships
  for each row execute function private.write_audit_log();
create trigger staff_members_audit after insert or update or delete on public.staff_members
  for each row execute function private.write_audit_log();

alter table public.audit_log enable row level security;

revoke all on public.audit_log from public, anon, authenticated;
grant select on public.audit_log to authenticated;
revoke all on sequence public.audit_log_id_seq from public, anon, authenticated;

create policy audit_log_select on public.audit_log
  for select to authenticated
  using (private.can(company_id, 'audit.read'));
