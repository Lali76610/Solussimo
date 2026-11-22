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
  insert into auth.users (id, aud, role, email, raw_user_meta_data)
  values (gen_random_uuid(), 'authenticated', 'authenticated', p_key || '@test.example', jsonb_build_object('display_name', p_display_name, 'locale', 'fr'))
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
end;
$$;

grant execute on all functions in schema tests to anon, authenticated;
