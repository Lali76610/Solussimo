-- =============================================================================
-- SOLUSSIMO — Migration 014 : données de santé (soins esthétiques) — protection renforcée
--  · D1 : fonction désactivée par défaut ; activation par le propriétaire après
--         vérification légale (consentement explicite, AIPD, information des clients)
--  · accès : personnes habilitées (owner/admin ou « praticien de soins ») + établissement
--    + consentement explicite actif ; jamais de lecture directe ; accès journalisés
--  · D3 : chiffrement AES-256 (pgcrypto) ; clé de 256 bits générée côté serveur et
--         conservée dans Supabase Vault (jamais dans le dépôt ni dans les migrations)
--  · retrait du consentement / désactivation ⇒ effacement immédiat
-- =============================================================================

-- Clé de chiffrement : générée ici, côté serveur, uniquement si elle n'existe pas.
do $$
begin
  if not exists (select 1 from vault.decrypted_secrets where name = 'solussimo_health_key_v1') then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'base64'),
      'solussimo_health_key_v1',
      'SOLUSSIMO : clé AES-256 des données de santé clients (v1)');
  end if;
end $$;

create or replace function private.health_key(p_name text)
returns text language plpgsql stable security definer set search_path = ''
as $$
declare
  v_key text;
begin
  select s.decrypted_secret into v_key from vault.decrypted_secrets s where s.name = p_name;
  if v_key is null then
    raise exception 'health_key_missing' using errcode = 'P0001';
  end if;
  return v_key;
end;
$$;
revoke all on function private.health_key(text) from public, anon, authenticated;

create table public.client_health_notes (
  client_id  uuid primary key,
  company_id uuid not null references public.companies (id) on delete cascade,
  ciphertext bytea not null,
  key_name   text not null,
  consent_id uuid not null references public.client_consents (id) on delete restrict,
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  foreign key (client_id, company_id) references public.clients (id, company_id) on delete cascade
);
create index client_health_notes_company_idx on public.client_health_notes (company_id);
create index client_health_notes_client_company_idx on public.client_health_notes (client_id, company_id);
create index client_health_notes_consent_idx on public.client_health_notes (consent_id);
create index client_health_notes_updated_by_idx on public.client_health_notes (updated_by);
-- RLS activée et AUCUN privilège : lecture/écriture uniquement par les fonctions ci-dessous.
alter table public.client_health_notes enable row level security;
revoke all on public.client_health_notes from public, anon, authenticated;

-- Habilitation santé : fonction activée + client visible + (owner/admin ou praticien habilité).
create or replace function private.can_access_health(p_client_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.clients c
    join public.companies co on co.id = c.company_id
    where c.id = p_client_id and c.status = 'active' and co.health_data_enabled
      and private.can_see_client_row(c.company_id, c.home_establishment_id, c.id)
      and (private.is_company_admin(c.company_id)
           or exists (select 1 from public.staff_members s
                      join public.memberships m on m.company_id = s.company_id and m.user_id = s.user_id
                      where s.company_id = c.company_id and s.user_id = (select auth.uid())
                        and s.active and s.health_practitioner))
  );
$$;

-- --- Lecture -----------------------------------------------------------------------
create or replace function private.get_client_health_notes(p_client_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_row public.client_health_notes%rowtype;
  v_company uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if not private.can_access_health(p_client_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if private.active_health_consent(p_client_id) is null then
    raise exception 'health_consent_required' using errcode = 'P0001';
  end if;
  select c.company_id into v_company from public.clients c where c.id = p_client_id;
  perform private.log_client_access(v_company, p_client_id, 'health_read');
  select * into v_row from public.client_health_notes h where h.client_id = p_client_id;
  if not found then
    return null;
  end if;
  return extensions.pgp_sym_decrypt(v_row.ciphertext, private.health_key(v_row.key_name))::jsonb;
end;
$$;

-- --- Écriture ----------------------------------------------------------------------
create or replace function private.set_client_health_notes(p_client_id uuid, p_notes jsonb)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_company uuid;
  v_consent uuid;
  v_clean jsonb;
  v_key constant text := 'solussimo_health_key_v1';
begin
  if (select auth.uid()) is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if not private.can_access_health(p_client_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  v_consent := private.active_health_consent(p_client_id);
  if v_consent is null then
    raise exception 'health_consent_required' using errcode = 'P0001';
  end if;
  if jsonb_typeof(p_notes) <> 'object'
     or exists (select 1 from jsonb_object_keys(p_notes) k
                where k not in ('allergies', 'contraindications', 'treatments', 'pregnancy', 'other')) then
    raise exception 'invalid_health_notes' using errcode = '22023';
  end if;
  -- Minimisation : textes ≤ 1 000 caractères, grossesse = booléen.
  select jsonb_object_agg(key, value) into v_clean
  from jsonb_each(p_notes)
  where (key = 'pregnancy' and jsonb_typeof(value) = 'boolean')
     or (key <> 'pregnancy' and jsonb_typeof(value) = 'string' and char_length(value #>> '{}') <= 1000);
  if (select count(*) from jsonb_object_keys(p_notes)) <> (select count(*) from jsonb_object_keys(coalesce(v_clean, '{}'))) then
    raise exception 'invalid_health_notes' using errcode = '22023';
  end if;

  select c.company_id into v_company from public.clients c where c.id = p_client_id;
  insert into public.client_health_notes (client_id, company_id, ciphertext, key_name, consent_id, updated_by, updated_at)
  values (p_client_id, v_company,
          extensions.pgp_sym_encrypt(coalesce(v_clean, '{}')::text, private.health_key(v_key), 'cipher-algo=aes256'),
          v_key, v_consent, (select auth.uid()), now())
  on conflict (client_id) do update
    set ciphertext = excluded.ciphertext, key_name = excluded.key_name, consent_id = excluded.consent_id,
        updated_by = excluded.updated_by, updated_at = excluded.updated_at;
  perform private.log_client_access(v_company, p_client_id, 'health_write');
end;
$$;

-- --- Retrait du consentement santé ⇒ effacement immédiat --------------------------------
create or replace function private.erase_health_on_withdrawal()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.purpose = 'health_data' and new.status = 'withdrawn' then
    delete from public.client_health_notes h where h.client_id = new.client_id;
    if found then
      perform private.log_client_access(new.company_id, new.client_id, 'health_erase');
    end if;
  end if;
  return null;
end;
$$;
create trigger client_consents_health_withdrawal after insert on public.client_consents
  for each row execute function private.erase_health_on_withdrawal();

-- --- Activation / désactivation par le propriétaire (D1) ---------------------------------
create or replace function private.set_health_data_enabled(
  p_company_id uuid, p_enabled boolean, p_ack_consent boolean, p_ack_dpia boolean, p_ack_information boolean
)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if not private.can(p_company_id, 'settings.health') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_enabled then
    if not (coalesce(p_ack_consent, false) and coalesce(p_ack_dpia, false) and coalesce(p_ack_information, false)) then
      raise exception 'legal_acknowledgement_required' using errcode = 'P0001';
    end if;
    update public.companies c set health_data_enabled = true, health_data_enabled_at = now(),
      health_data_enabled_by = (select auth.uid()) where c.id = p_company_id;
  else
    -- Désactivation : effacement de toutes les données de santé de l'entreprise (minimisation).
    delete from public.client_health_notes h where h.company_id = p_company_id;
    update public.companies c set health_data_enabled = false, health_data_enabled_at = null,
      health_data_enabled_by = null where c.id = p_company_id;
  end if;
end;
$$;

revoke all on function
  private.can_access_health(uuid), private.get_client_health_notes(uuid),
  private.set_client_health_notes(uuid, jsonb), private.set_health_data_enabled(uuid, boolean, boolean, boolean, boolean)
from public, anon;
grant execute on function
  private.can_access_health(uuid), private.get_client_health_notes(uuid),
  private.set_client_health_notes(uuid, jsonb), private.set_health_data_enabled(uuid, boolean, boolean, boolean, boolean)
to authenticated;

create function public.get_client_health_notes(p_client_id uuid)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.get_client_health_notes(p_client_id); $$;
create function public.set_client_health_notes(p_client_id uuid, p_notes jsonb)
returns void language sql security invoker set search_path = ''
as $$ select private.set_client_health_notes(p_client_id, p_notes); $$;
create function public.can_access_health(p_client_id uuid)
returns boolean language sql stable security invoker set search_path = ''
as $$ select private.can_access_health(p_client_id); $$;
create function public.set_health_data_enabled(
  p_company_id uuid, p_enabled boolean, p_ack_consent boolean default false,
  p_ack_dpia boolean default false, p_ack_information boolean default false)
returns void language sql security invoker set search_path = ''
as $$ select private.set_health_data_enabled(p_company_id, p_enabled, p_ack_consent, p_ack_dpia, p_ack_information); $$;

revoke all on function
  public.get_client_health_notes(uuid), public.set_client_health_notes(uuid, jsonb),
  public.can_access_health(uuid), public.set_health_data_enabled(uuid, boolean, boolean, boolean, boolean)
from public, anon;
grant execute on function
  public.get_client_health_notes(uuid), public.set_client_health_notes(uuid, jsonb),
  public.can_access_health(uuid), public.set_health_data_enabled(uuid, boolean, boolean, boolean, boolean)
to authenticated;

revoke all on all functions in schema private from public, anon;
