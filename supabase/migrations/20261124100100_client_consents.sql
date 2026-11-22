-- =============================================================================
-- SOLUSSIMO — Migration 013 : consentements clients
--  · historique en AJOUT SEUL (aucune modification ni suppression possible)
--  · par finalité et par canal ; preuve : méthode, version du texte, auteur, date
--  · état courant = dernier événement (vue)
-- =============================================================================

create type public.consent_purpose as enum ('marketing', 'newsletter', 'appointment_reminders', 'health_data');
create type public.consent_channel as enum ('email', 'sms', 'whatsapp', 'postal', 'none');
create type public.consent_status as enum ('granted', 'withdrawn');
create type public.consent_method as enum ('in_salon_verbal', 'in_salon_signed', 'online_form', 'import', 'system');

create table public.client_consents (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies (id) on delete cascade,
  client_id       uuid not null,
  purpose         public.consent_purpose not null,
  channel         public.consent_channel not null,
  status          public.consent_status not null,
  method          public.consent_method not null default 'in_salon_verbal',
  wording_version text not null default 'v1' check (char_length(wording_version) between 1 and 40),
  captured_by     uuid references auth.users (id) on delete set null,
  captured_at     timestamptz not null default clock_timestamp(),
  -- Les données de santé n'ont pas de canal ; les finalités marketing en ont toujours un.
  check ((purpose = 'health_data') = (channel = 'none')),
  foreign key (client_id, company_id) references public.clients (id, company_id) on delete cascade
);
create index client_consents_client_idx on public.client_consents (client_id, purpose, channel, captured_at desc);
create index client_consents_client_company_idx on public.client_consents (client_id, company_id);
create index client_consents_company_idx on public.client_consents (company_id);
create index client_consents_captured_by_idx on public.client_consents (captured_by);

create or replace function private.before_consent_insert()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  new.captured_by := (select auth.uid());
  -- Horloge réelle (et non l'heure de début de transaction) : ordre strict des événements.
  new.captured_at := clock_timestamp();
  -- D1 : consentement santé uniquement si la fonction est activée par le propriétaire.
  if new.purpose = 'health_data' and new.status = 'granted'
     and not exists (select 1 from public.companies c where c.id = new.company_id and c.health_data_enabled) then
    raise exception 'health_data_disabled' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger client_consents_before_insert before insert on public.client_consents
  for each row
  when (pg_trigger_depth() = 0)
  execute function private.before_consent_insert();
create trigger client_consents_audit after insert on public.client_consents
  for each row execute function private.write_audit_log();

alter table public.client_consents enable row level security;
revoke all on public.client_consents from public, anon, authenticated;
grant select on public.client_consents to authenticated;
grant insert (company_id, client_id, purpose, channel, status, method, wording_version) on public.client_consents to authenticated;
-- Pas de grant UPDATE / DELETE : historique non modifiable.
create policy client_consents_select on public.client_consents for select to authenticated
  using (private.can_see_client(client_id));
create policy client_consents_insert on public.client_consents for insert to authenticated
  with check (private.can(company_id, 'consent.write') and private.can_write_client(client_id));

-- État courant (dernier événement par finalité et canal). Hérite de la RLS de la table.
create view public.client_consent_status with (security_invoker = true) as
  select distinct on (client_id, purpose, channel)
         client_id, company_id, purpose, channel, status, method, wording_version, captured_at
  from public.client_consents
  order by client_id, purpose, channel, captured_at desc, id desc;
revoke all on public.client_consent_status from public, anon, authenticated;
grant select on public.client_consent_status to authenticated;

-- Consentement santé actif (dernier événement = granted) → identifiant, sinon null.
create or replace function private.active_health_consent(p_client_id uuid)
returns uuid language sql stable security definer set search_path = ''
as $$
  select case when c.status = 'granted' then c.id end
  from public.client_consents c
  where c.client_id = p_client_id and c.purpose = 'health_data'
  order by c.captured_at desc, c.id desc
  limit 1;
$$;
revoke all on function private.active_health_consent(uuid) from public, anon;
