-- =============================================================================
-- Outillage de test SQL (schéma « tests ») — jamais déployé en production.
-- Fournit : création d'utilisateurs fictifs, simulation de JWT, assertions.
-- Les assertions lèvent une exception à la moindre anomalie (ON_ERROR_STOP).
-- =============================================================================

drop schema if exists tests cascade;
create schema tests;
grant usage on schema tests to anon, authenticated;
create sequence tests.counter;
grant usage on sequence tests.counter to anon, authenticated;

-- Utilisateur fictif (domaine réservé .example, RFC 2606).
create function tests.create_user(p_key text, p_display_name text)
returns uuid language sql security definer set search_path = '' as $$
  insert into auth.users (id, aud, role, email, email_confirmed_at, raw_user_meta_data)
  values (gen_random_uuid(), 'authenticated', 'authenticated', p_key || '@test.example', now(), jsonb_build_object('display_name', p_display_name, 'locale', 'fr'))
  returning id;
$$;

create function tests.uid(p_key text)
returns uuid language sql stable security definer set search_path = '' as $$
  select id from auth.users where email = p_key || '@test.example';
$$;

create function tests.company(p_name text)
returns uuid language sql stable security definer set search_path = '' as $$
  select id from public.companies where name = p_name;
$$;

create function tests.establishment(p_company_name text)
returns uuid language sql stable security definer set search_path = '' as $$
  select e.id from public.establishments e join public.companies c on c.id = e.company_id
  where c.name = p_company_name order by e.created_at limit 1;
$$;

create function tests.staff(p_display_name text)
returns uuid language sql stable security definer set search_path = '' as $$
  select id from public.staff_members where display_name = p_display_name;
$$;

create function tests.establishment_named(p_name text)
returns uuid language sql stable security definer set search_path = '' as $$
  select id from public.establishments where name = p_name;
$$;

create function tests.service(p_name text)
returns uuid language sql stable security definer set search_path = '' as $$
  select id from public.services where name = p_name;
$$;

create function tests.appointment(p_label text)
returns uuid language sql stable security definer set search_path = '' as $$
  select id from public.appointments where client_label = p_label;
$$;

create function tests.client(p_first_name text)
returns uuid language sql stable security definer set search_path = '' as $$
  select id from public.clients where first_name = p_first_name and status = 'active' order by created_at limit 1;
$$;

create function tests.client_any(p_id uuid)
returns public.clients language sql stable security definer set search_path = '' as $$
  select * from public.clients where id = p_id;
$$;

-- Caisse (V0.5) : caisse par défaut d'un établissement, moyen de paiement par type.
create function tests.register(p_establishment_id uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select id from public.cash_registers where establishment_id = p_establishment_id order by created_at limit 1;
$$;

create function tests.method(p_company_name text, p_kind text)
returns uuid language sql stable security definer set search_path = '' as $$
  select m.id from public.payment_methods m join public.companies c on c.id = m.company_id
  where c.name = p_company_name and m.kind::text = p_kind order by m.sort limit 1;
$$;

-- Jeu de données Clients : établissement Nord + fiches fictives (numéros ARCEP « fiction » 06 39 98).
create function tests.seed_clients()
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', tests.uid('alice'))::text, true);
  insert into public.establishments (company_id, name, country_code, timezone)
  values (tests.company('Salon A'), 'Salon A Nord', 'FR', 'Europe/Paris');
  insert into public.clients (company_id, home_establishment_id, first_name, last_name, email, phone_e164, birthday_month, birthday_day)
  values (tests.company('Salon A'), tests.establishment('Salon A'), 'Léa', 'Bernard', 'lea@exemple.example', '+33639980001', 3, 14),
         (tests.company('Salon A'), tests.establishment_named('Salon A Nord'), 'Nina', 'Nord', 'nina@exemple.example', '+33639980002', null, null);
  insert into public.services (company_id, name, duration_minutes, price_cents) values (tests.company('Salon A'), 'Coupe', 30, 3200);
  perform public.set_staff_week_schedule(tests.staff('Collaborateur A1'), tests.establishment('Salon A'),
    '[{"weekday":1,"start":"09:00","end":"19:00"},{"weekday":2,"start":"09:00","end":"19:00"}]');
  perform set_config('request.jwt.claims', json_build_object('sub', tests.uid('bob'))::text, true);
  insert into public.clients (company_id, home_establishment_id, first_name, last_name, email)
  values (tests.company('Salon B'), tests.establishment('Salon B'), 'Bruno', 'Bob', 'bruno@exemple.example');
  perform set_config('request.jwt.claims', '', true);
end;
$$;

-- Simule le JWT transmis par PostgREST (doit être suivi de SET LOCAL ROLE dans le script).
create function tests.authenticate_as(p_key text)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', tests.uid(p_key), 'role', 'authenticated')::text, true);
end;
$$;

create function tests.clear_authentication()
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
end;
$$;

create function tests.pass(p_message text)
returns void language plpgsql as $$
begin
  raise notice 'ok %  - %', nextval('tests.counter'), p_message;
end;
$$;

create function tests.ok(p_condition boolean, p_message text)
returns void language plpgsql as $$
begin
  if p_condition is not true then
    raise exception 'ÉCHEC: %', p_message;
  end if;
  perform tests.pass(p_message);
end;
$$;

-- La requête doit échouer (optionnellement avec un SQLSTATE précis).
create function tests.throws(p_sql text, p_message text, p_errcode text default null)
returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if p_errcode is not null and sqlstate <> p_errcode then
      raise exception 'ÉCHEC: % (SQLSTATE attendu %, obtenu % : %)', p_message, p_errcode, sqlstate, sqlerrm;
    end if;
    perform tests.pass(p_message || ' [' || sqlstate || ']');
    return;
  end;
  raise exception 'ÉCHEC: % (aucune erreur levée)', p_message;
end;
$$;

-- La requête doit réussir.
create function tests.lives(p_sql text, p_message text)
returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    raise exception 'ÉCHEC: % (% : %)', p_message, sqlstate, sqlerrm;
  end;
  perform tests.pass(p_message);
end;
$$;

-- Nombre de lignes renvoyées par une requête SELECT.
create function tests.count(p_sql text)
returns bigint language plpgsql as $$
declare v bigint;
begin
  execute 'select count(*) from (' || p_sql || ') q' into v;
  return v;
end;
$$;

-- Nombre de lignes affectées par un UPDATE / DELETE.
create function tests.affected(p_sql text)
returns bigint language plpgsql as $$
declare v bigint;
begin
  execute p_sql;
  get diagnostics v = row_count;
  return v;
end;
$$;

-- Jeu de données FICTIF commun : deux entreprises concurrentes.
--   Salon A : alice (owner), dave (admin), erin (manager), carol (staff)
--   Salon B : bob (owner)
create function tests.seed()
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform tests.create_user('alice', 'Alice');
  perform tests.create_user('bob', 'Bob');
  perform tests.create_user('carol', 'Carol');
  perform tests.create_user('dave', 'Dave');
  perform tests.create_user('erin', 'Erin');

  perform set_config('request.jwt.claims', json_build_object('sub', tests.uid('alice'))::text, true);
  perform public.create_company_with_establishment('Salon A', 'Salon A Centre', 'hair_salon', 'FR', 'Lyon', 'Europe/Paris', 'fr', 'EUR');
  perform set_config('request.jwt.claims', json_build_object('sub', tests.uid('bob'))::text, true);
  perform public.create_company_with_establishment('Salon B', 'Salon B Gare', 'beauty_institute', 'ES', 'Madrid', 'Europe/Madrid', 'es', 'EUR');
  perform set_config('request.jwt.claims', '', true);

  -- Adhésions supplémentaires (simule le futur flux d'invitation, exécuté côté serveur).
  insert into public.memberships (company_id, user_id, role) values
    (tests.company('Salon A'), tests.uid('dave'),  'admin'),
    (tests.company('Salon A'), tests.uid('erin'),  'manager'),
    (tests.company('Salon A'), tests.uid('carol'), 'staff');

  insert into public.staff_members (company_id, establishment_id, display_name, job) values
    (tests.company('Salon A'), tests.establishment('Salon A'), 'Collaborateur A1', 'stylist'),
    (tests.company('Salon B'), tests.establishment('Salon B'), 'Collaborateur B1', 'beautician');

  -- Fiches liées aux comptes de l'équipe A (affectées à l'établissement A).
  insert into public.staff_members (company_id, establishment_id, user_id, display_name, job) values
    (tests.company('Salon A'), tests.establishment('Salon A'), tests.uid('dave'),  'Dave',  'manager'),
    (tests.company('Salon A'), tests.establishment('Salon A'), tests.uid('erin'),  'Erin',  'manager'),
    (tests.company('Salon A'), tests.establishment('Salon A'), tests.uid('carol'), 'Carol', 'stylist');
end;
$$;

grant execute on all functions in schema tests to anon, authenticated;
