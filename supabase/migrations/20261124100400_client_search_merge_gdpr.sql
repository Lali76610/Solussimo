-- =============================================================================
-- SOLUSSIMO — Migration 016 : recherche, doublons, fusion, coordonnées, RGPD
--  · search_clients : tolérante (accents, fautes), 50 résultats max, visibilité par
--    établissement ; le rôle staff doit saisir ≥ 2 caractères (anti-aspiration)
--  · find_duplicate_candidates / merge_clients (D7 : responsables dans leurs établissements)
--  · reveal_client_contact (D2 : permission vérifiée côté serveur + journal)
--  · export_client_data / erase_client (RGPD) · clients_to_review / set_retention_settings (D6)
-- =============================================================================

create or replace function private.search_norm(p text)
returns text language sql stable set search_path = ''
as $$ select lower(extensions.unaccent('extensions.unaccent'::regdictionary, coalesce(btrim(p), ''))); $$;

-- --- Recherche ------------------------------------------------------------------------
create or replace function private.search_clients(
  p_company_id uuid, p_query text, p_establishment_id uuid, p_tag text, p_last_visit text,
  p_marketing boolean, p_birthday_this_month boolean, p_limit integer, p_offset integer
)
returns table (
  id uuid, first_name text, last_name text, email_masked text, phone_masked text, tags text[],
  home_establishment_id uuid, last_visit_at timestamptz, next_visit_at timestamptz, visits bigint,
  no_shows bigint, marketing_ok boolean, birthday_month smallint, birthday_day smallint
)
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_q text := private.search_norm(p_query);
  v_digits text := regexp_replace(coalesce(p_query, ''), '[^0-9]', '', 'g');
begin
  if not private.can(p_company_id, 'client.read') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  -- Anti-aspiration : un collaborateur ne liste pas tout le fichier.
  if char_length(v_q) < 2 and not private.has_company_role(p_company_id, array['owner', 'admin', 'manager']::public.company_role[]) then
    raise exception 'query_too_short' using errcode = '22023';
  end if;
  return query
  with base as (
    select c.*,
           case when v_q = '' then 0
                else greatest(extensions.word_similarity(v_q, c.search_text),
                              case when c.search_text like '%' || v_q || '%' then 1 else 0 end,
                              case when char_length(v_digits) >= 4 and c.search_text like '%' || v_digits || '%' then 1 else 0 end)
           end as score
    from public.clients c
    where c.company_id = p_company_id
      and c.status = 'active'
      and private.can_see_client_row(c.company_id, c.home_establishment_id, c.id)
      and (p_establishment_id is null or c.home_establishment_id = p_establishment_id
           or exists (select 1 from public.appointments a where a.client_id = c.id and a.establishment_id = p_establishment_id))
      and (p_tag is null or p_tag = any (c.tags))
      and (not coalesce(p_birthday_this_month, false) or c.birthday_month = extract(month from now())::smallint)
      and (v_q = '' or c.search_text like '%' || v_q || '%'
           or (char_length(v_digits) >= 4 and c.search_text like '%' || v_digits || '%')
           or extensions.word_similarity(v_q, c.search_text) >= 0.4)
  ), stats as (
    select b.*,
      (select max(a.starts_at) from public.appointments a where a.client_id = b.id and a.status in ('booked', 'completed') and a.starts_at <= now()) as lv,
      (select min(a.starts_at) from public.appointments a where a.client_id = b.id and a.status = 'booked' and a.starts_at > now()) as nv,
      (select count(*) from public.appointments a where a.client_id = b.id and a.status in ('booked', 'completed') and a.starts_at <= now()) as nvis,
      (select count(*) from public.appointments a where a.client_id = b.id and a.status = 'no_show') as nns,
      exists (select 1 from public.client_consent_status s where s.client_id = b.id and s.purpose = 'marketing' and s.status = 'granted') as mk
    from base b
  )
  select s.id, s.first_name, s.last_name, s.email_masked, s.phone_masked, s.tags, s.home_establishment_id,
         s.lv, s.nv, s.nvis, s.nns, s.mk, s.birthday_month, s.birthday_day
  from stats s
  where (p_marketing is null or s.mk = p_marketing)
    and (p_last_visit is null
         or (p_last_visit = 'never' and s.lv is null)
         or (p_last_visit = 'lt1m' and s.lv >= now() - interval '1 month')
         or (p_last_visit = '1to6m' and s.lv < now() - interval '1 month' and s.lv >= now() - interval '6 months')
         or (p_last_visit = 'gt6m' and s.lv < now() - interval '6 months'))
  order by s.score desc, s.last_name nulls last, s.first_name nulls last, s.id
  limit least(greatest(coalesce(p_limit, 50), 1), 50)
  offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

-- --- Doublons ------------------------------------------------------------------------
create or replace function private.find_duplicate_candidates(
  p_company_id uuid, p_first_name text, p_last_name text, p_email text, p_phone text, p_exclude uuid
)
returns table (id uuid, first_name text, last_name text, email_masked text, phone_masked text, score integer)
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_name text := private.search_norm(concat_ws(' ', p_first_name, p_last_name));
  v_email text := nullif(lower(btrim(p_email)), '');
  v_phone text := nullif(regexp_replace(coalesce(p_phone, ''), '[^0-9+]', '', 'g'), '');
begin
  if not private.can(p_company_id, 'client.read') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
  select c.id, c.first_name, c.last_name, c.email_masked, c.phone_masked,
         (case when v_email is not null and c.email = v_email then 100 else 0 end
          + case when v_phone is not null and c.phone_e164 = v_phone then 100 else 0 end
          + case when char_length(v_name) >= 3
                      and extensions.similarity(v_name, private.search_norm(concat_ws(' ', c.first_name, c.last_name))) > 0.6
                 then 60 else 0 end)::integer as sc
  from public.clients c
  where c.company_id = p_company_id and c.status = 'active'
    and c.id is distinct from p_exclude
    and private.can_see_client_row(c.company_id, c.home_establishment_id, c.id)
    and ((v_email is not null and c.email = v_email)
         or (v_phone is not null and c.phone_e164 = v_phone)
         or (char_length(v_name) >= 3
             and extensions.similarity(v_name, private.search_norm(concat_ws(' ', c.first_name, c.last_name))) > 0.6))
  order by sc desc
  limit 5;
end;
$$;

-- --- Coordonnées complètes (D2) -----------------------------------------------------------
create or replace function private.reveal_client_contact(p_client_id uuid)
returns table (email text, phone_e164 text)
language plpgsql security definer set search_path = ''
as $$
declare
  v_client public.clients%rowtype;
begin
  select * into v_client from public.clients c where c.id = p_client_id;
  if not found or v_client.status <> 'active'
     or not private.can(v_client.company_id, 'client.contact.read')
     or not private.can_see_client_row(v_client.company_id, v_client.home_establishment_id, v_client.id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  perform private.log_client_access(v_client.company_id, v_client.id, 'contact_reveal');
  return query select v_client.email, v_client.phone_e164;
end;
$$;

-- --- Fusion de doublons (D7) --------------------------------------------------------------
-- p_take : champs à reprendre de la fiche fusionnée, ex. {"email": true, "phone_e164": true}
create or replace function private.merge_clients(p_keep_id uuid, p_merge_id uuid, p_take jsonb)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_keep public.clients%rowtype;
  v_merge public.clients%rowtype;
  v_take jsonb := coalesce(p_take, '{}');
  r record;
begin
  if (select auth.uid()) is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if p_keep_id = p_merge_id then
    raise exception 'invalid_merge' using errcode = '22023';
  end if;
  -- Verrous dans un ordre déterministe : pas d'interblocage entre fusions concurrentes.
  perform 1 from public.clients c where c.id in (p_keep_id, p_merge_id) order by c.id for update;
  select * into v_keep from public.clients c where c.id = p_keep_id;
  select * into v_merge from public.clients c where c.id = p_merge_id;
  if v_keep.id is null or v_merge.id is null or v_keep.company_id <> v_merge.company_id then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_keep.status <> 'active' or v_merge.status <> 'active' then
    raise exception 'client_unavailable' using errcode = 'P0001';
  end if;
  -- D7 : owner/admin, ou responsable habilité dans les établissements des DEUX fiches.
  if not (private.can_in_establishment(v_keep.home_establishment_id, 'client.merge')
          and private.can_in_establishment(v_merge.home_establishment_id, 'client.merge')) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- Libère les identifiants uniques de la fiche fusionnée avant reprise éventuelle.
  update public.clients c set email = null, phone_e164 = null where c.id = v_merge.id;
  update public.clients c set
    first_name = case when (v_take ->> 'first_name')::boolean then coalesce(v_merge.first_name, c.first_name) else coalesce(c.first_name, v_merge.first_name) end,
    last_name = case when (v_take ->> 'last_name')::boolean then coalesce(v_merge.last_name, c.last_name) else coalesce(c.last_name, v_merge.last_name) end,
    email = case when (v_take ->> 'email')::boolean then coalesce(v_merge.email, c.email) else coalesce(c.email, v_merge.email) end,
    phone_e164 = case when (v_take ->> 'phone_e164')::boolean then coalesce(v_merge.phone_e164, c.phone_e164) else coalesce(c.phone_e164, v_merge.phone_e164) end,
    birthday_month = coalesce(c.birthday_month, v_merge.birthday_month),
    birthday_day = case when c.birthday_month is null then v_merge.birthday_day else c.birthday_day end,
    preferred_staff_id = coalesce(c.preferred_staff_id, v_merge.preferred_staff_id),
    general_note = left(concat_ws(' · ', c.general_note, v_merge.general_note), 500),
    tags = (select coalesce(array_agg(distinct t), '{}') from (select unnest(c.tags || v_merge.tags) t limit 10) x)
  where c.id = v_keep.id;

  update public.appointments a set client_id = v_keep.id where a.client_id = v_merge.id;
  insert into public.client_favorite_services (client_id, service_id, company_id)
    select v_keep.id, f.service_id, f.company_id from public.client_favorite_services f where f.client_id = v_merge.id
    on conflict do nothing;
  delete from public.client_favorite_services f where f.client_id = v_merge.id;
  update public.client_technical_notes n set client_id = v_keep.id where n.client_id = v_merge.id;

  -- Consentements : historique des deux fiches conservé ; l'état le plus restrictif l'emporte.
  update public.client_consents k set client_id = v_keep.id where k.client_id = v_merge.id;
  for r in
    select distinct on (purpose, channel) purpose, channel, status
    from public.client_consents where client_id = v_keep.id
    order by purpose, channel, captured_at desc, id desc
  loop
    if r.status = 'granted' and exists (
      select 1 from public.client_consents w
      where w.client_id = v_keep.id and w.purpose = r.purpose and w.channel = r.channel and w.status = 'withdrawn') then
      insert into public.client_consents (company_id, client_id, purpose, channel, status, method, wording_version, captured_by)
      values (v_keep.company_id, v_keep.id, r.purpose, r.channel, 'withdrawn', 'system', 'merge', (select auth.uid()));
    end if;
  end loop;
  -- Données de santé : la fiche fusionnée n'en conserve jamais (re-saisie sous consentement).
  delete from public.client_health_notes h where h.client_id = v_merge.id;

  update public.clients c set status = 'anonymized', merged_into = v_keep.id, first_name = null, last_name = null,
    email = null, phone_e164 = null, birthday_month = null, birthday_day = null, preferred_staff_id = null,
    preferred_days = '{}', preferred_time = null, general_note = null, tags = '{}'
  where c.id = v_merge.id;
  perform private.log_client_access(v_keep.company_id, v_keep.id, 'merge');
  return v_keep.id;
end;
$$;

-- --- Export (droit d'accès / portabilité) ---------------------------------------------------
create or replace function private.export_client_data(p_client_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_client public.clients%rowtype;
  v_health jsonb;
begin
  select * into v_client from public.clients c where c.id = p_client_id;
  if not found or not private.can(v_client.company_id, 'client.export')
     or not private.can_see_client_row(v_client.company_id, v_client.home_establishment_id, v_client.id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if private.can_access_health(p_client_id) and private.active_health_consent(p_client_id) is not null then
    v_health := private.get_client_health_notes(p_client_id);
  end if;
  perform private.log_client_access(v_client.company_id, v_client.id, 'export');
  return jsonb_build_object(
    'exported_at', now(),
    'client', jsonb_build_object(
      'first_name', v_client.first_name, 'last_name', v_client.last_name, 'email', v_client.email,
      'phone', v_client.phone_e164, 'birthday', case when v_client.birthday_month is not null
        then lpad(v_client.birthday_day::text, 2, '0') || '/' || lpad(v_client.birthday_month::text, 2, '0') end,
      'preferred_locale', v_client.preferred_locale, 'preferred_days', v_client.preferred_days,
      'preferred_time', v_client.preferred_time, 'general_note', v_client.general_note, 'tags', v_client.tags,
      'created_at', v_client.created_at),
    'favorite_services', coalesce((select jsonb_agg(s.name order by s.name) from public.client_favorite_services f
                                   join public.services s on s.id = f.service_id where f.client_id = p_client_id), '[]'),
    'technical_notes', coalesce((select jsonb_agg(jsonb_build_object('kind', n.kind, 'content', n.content, 'date', n.created_at) order by n.created_at)
                                 from public.client_technical_notes n where n.client_id = p_client_id), '[]'),
    'consents', coalesce((select jsonb_agg(jsonb_build_object('purpose', k.purpose, 'channel', k.channel, 'status', k.status,
                                   'method', k.method, 'wording_version', k.wording_version, 'date', k.captured_at) order by k.captured_at)
                          from public.client_consents k where k.client_id = p_client_id), '[]'),
    'appointments', coalesce((select jsonb_agg(jsonb_build_object('starts_at', a.starts_at, 'service', s.name,
                                   'staff', st.display_name, 'status', a.status, 'price_cents', a.price_cents) order by a.starts_at)
                              from public.appointments a join public.services s on s.id = a.service_id
                              join public.staff_members st on st.id = a.staff_id where a.client_id = p_client_id), '[]'),
    'health_data', v_health
  );
end;
$$;

-- --- Effacement (anonymisation ; rendez-vous conservés pour la comptabilité) -----------------
create or replace function private.erase_client(p_client_id uuid, p_confirm boolean)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_client public.clients%rowtype;
begin
  select * into v_client from public.clients c where c.id = p_client_id for update;
  if not found or not private.can(v_client.company_id, 'client.erase')
     or not private.can_see_client_row(v_client.company_id, v_client.home_establishment_id, v_client.id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not coalesce(p_confirm, false) then
    raise exception 'confirmation_required' using errcode = '22023';
  end if;
  delete from public.client_health_notes h where h.client_id = p_client_id;
  delete from public.client_technical_notes n where n.client_id = p_client_id;
  delete from public.client_favorite_services f where f.client_id = p_client_id;
  update public.appointments a set client_label = '—' where a.client_id = p_client_id;
  update public.clients c set status = 'anonymized', first_name = null, last_name = null, email = null,
    phone_e164 = null, birthday_month = null, birthday_day = null, preferred_locale = null, preferred_staff_id = null,
    preferred_days = '{}', preferred_time = null, general_note = null, tags = '{}'
  where c.id = p_client_id;
  perform private.log_client_access(v_client.company_id, v_client.id, 'erase');
end;
$$;

-- --- Réexamen des fiches inactives (D6 : jamais de suppression automatique) ---------------------
create or replace function private.clients_to_review(p_company_id uuid)
returns table (id uuid, first_name text, last_name text, last_activity timestamptz)
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_months smallint;
begin
  if not private.can(p_company_id, 'settings.retention') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select c.client_review_months into v_months from public.companies c where c.id = p_company_id;
  return query
  select c.id, c.first_name, c.last_name, x.last_activity
  from public.clients c
  cross join lateral (
    select greatest(c.created_at, (select max(a.starts_at) from public.appointments a where a.client_id = c.id)) as last_activity
  ) x
  where c.company_id = p_company_id and c.status = 'active'
    and x.last_activity < now() - make_interval(months => v_months)
  order by x.last_activity
  limit 200;
end;
$$;

create or replace function private.set_retention_settings(p_company_id uuid, p_review_months integer, p_accounting_years integer)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if not private.can(p_company_id, 'settings.retention') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  update public.companies c
  set client_review_months = p_review_months, accounting_retention_years = p_accounting_years
  where c.id = p_company_id;
end;
$$;

revoke all on function
  private.search_norm(text),
  private.search_clients(uuid, text, uuid, text, text, boolean, boolean, integer, integer),
  private.find_duplicate_candidates(uuid, text, text, text, text, uuid),
  private.reveal_client_contact(uuid), private.merge_clients(uuid, uuid, jsonb),
  private.export_client_data(uuid), private.erase_client(uuid, boolean),
  private.clients_to_review(uuid), private.set_retention_settings(uuid, integer, integer)
from public, anon;
grant execute on function
  private.search_clients(uuid, text, uuid, text, text, boolean, boolean, integer, integer),
  private.find_duplicate_candidates(uuid, text, text, text, text, uuid),
  private.reveal_client_contact(uuid), private.merge_clients(uuid, uuid, jsonb),
  private.export_client_data(uuid), private.erase_client(uuid, boolean),
  private.clients_to_review(uuid), private.set_retention_settings(uuid, integer, integer)
to authenticated;

-- --- Enveloppes API (SECURITY INVOKER) -------------------------------------------------------
create function public.search_clients(
  p_company_id uuid, p_query text default '', p_establishment_id uuid default null, p_tag text default null,
  p_last_visit text default null, p_marketing boolean default null, p_birthday_this_month boolean default false,
  p_limit integer default 50, p_offset integer default 0)
returns table (
  id uuid, first_name text, last_name text, email_masked text, phone_masked text, tags text[],
  home_establishment_id uuid, last_visit_at timestamptz, next_visit_at timestamptz, visits bigint,
  no_shows bigint, marketing_ok boolean, birthday_month smallint, birthday_day smallint)
language sql stable security invoker set search_path = ''
as $$ select * from private.search_clients(p_company_id, p_query, p_establishment_id, p_tag, p_last_visit, p_marketing, p_birthday_this_month, p_limit, p_offset); $$;

create function public.find_duplicate_candidates(
  p_company_id uuid, p_first_name text default null, p_last_name text default null,
  p_email text default null, p_phone text default null, p_exclude uuid default null)
returns table (id uuid, first_name text, last_name text, email_masked text, phone_masked text, score integer)
language sql stable security invoker set search_path = ''
as $$ select * from private.find_duplicate_candidates(p_company_id, p_first_name, p_last_name, p_email, p_phone, p_exclude); $$;

create function public.reveal_client_contact(p_client_id uuid)
returns table (email text, phone_e164 text)
language sql security invoker set search_path = ''
as $$ select * from private.reveal_client_contact(p_client_id); $$;

create function public.merge_clients(p_keep_id uuid, p_merge_id uuid, p_take jsonb default '{}')
returns uuid language sql security invoker set search_path = ''
as $$ select private.merge_clients(p_keep_id, p_merge_id, p_take); $$;

create function public.export_client_data(p_client_id uuid)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.export_client_data(p_client_id); $$;

create function public.erase_client(p_client_id uuid, p_confirm boolean)
returns void language sql security invoker set search_path = ''
as $$ select private.erase_client(p_client_id, p_confirm); $$;

create function public.clients_to_review(p_company_id uuid)
returns table (id uuid, first_name text, last_name text, last_activity timestamptz)
language sql stable security invoker set search_path = ''
as $$ select * from private.clients_to_review(p_company_id); $$;

create function public.set_retention_settings(p_company_id uuid, p_review_months integer, p_accounting_years integer)
returns void language sql security invoker set search_path = ''
as $$ select private.set_retention_settings(p_company_id, p_review_months, p_accounting_years); $$;

revoke all on function
  public.search_clients(uuid, text, uuid, text, text, boolean, boolean, integer, integer),
  public.find_duplicate_candidates(uuid, text, text, text, text, uuid),
  public.reveal_client_contact(uuid), public.merge_clients(uuid, uuid, jsonb),
  public.export_client_data(uuid), public.erase_client(uuid, boolean),
  public.clients_to_review(uuid), public.set_retention_settings(uuid, integer, integer)
from public, anon;
grant execute on function
  public.search_clients(uuid, text, uuid, text, text, boolean, boolean, integer, integer),
  public.find_duplicate_candidates(uuid, text, text, text, text, uuid),
  public.reveal_client_contact(uuid), public.merge_clients(uuid, uuid, jsonb),
  public.export_client_data(uuid), public.erase_client(uuid, boolean),
  public.clients_to_review(uuid), public.set_retention_settings(uuid, integer, integer)
to authenticated;

revoke all on all functions in schema private from public, anon;
