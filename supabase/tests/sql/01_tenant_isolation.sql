\o /dev/null
-- Isolation multi-tenant : l'entreprise B ne peut JAMAIS lire ni modifier l'entreprise A.
begin;
select tests.seed();

-- ---------------------------------------------------------------- anonyme ----
set local role anon;
select tests.clear_authentication();
select tests.throws('select * from public.companies', 'anon : lecture companies refusée', '42501');
select tests.throws('select * from public.establishments', 'anon : lecture establishments refusée', '42501');
select tests.throws('select * from public.memberships', 'anon : lecture memberships refusée', '42501');
select tests.throws('select * from public.staff_members', 'anon : lecture staff_members refusée', '42501');
select tests.throws('select * from public.profiles', 'anon : lecture profiles refusée', '42501');
select tests.throws('select * from public.audit_log', 'anon : lecture audit_log refusée', '42501');
select tests.throws($$select public.create_company_with_establishment('X','X','hair_salon','FR',null,'Europe/Paris','fr','EUR')$$,
  'anon : création de salon refusée', '42501');
reset role;

-- ------------------------------------- authentifié sans JWT valide (sub vide) --
set local role authenticated;
select tests.clear_authentication();
select tests.ok(tests.count('select * from public.companies') = 0, 'authenticated sans sub : aucune entreprise visible');
select tests.throws($$select public.create_company_with_establishment('X','X','hair_salon','FR',null,'Europe/Paris','fr','EUR')$$,
  'authenticated sans sub : création refusée', '28000');
reset role;

-- --------------------------------------------- Bob (owner B) attaque A ------
set local role authenticated;
select tests.authenticate_as('bob');

select tests.ok(tests.count('select * from public.companies') = 1, 'Bob ne voit qu''une entreprise (la sienne)');
select tests.ok(tests.count(format('select * from public.companies where id = %L', tests.company('Salon A'))) = 0,
  'Bob : entreprise A invisible');
select tests.ok(tests.count(format('select * from public.establishments where company_id = %L', tests.company('Salon A'))) = 0,
  'Bob : établissements de A invisibles');
select tests.ok(tests.count(format('select * from public.staff_members where company_id = %L', tests.company('Salon A'))) = 0,
  'Bob : collaborateurs de A invisibles');
select tests.ok(tests.count(format('select * from public.memberships where company_id = %L', tests.company('Salon A'))) = 0,
  'Bob : membres de A invisibles');
select tests.ok(tests.count(format('select * from public.audit_log where company_id = %L', tests.company('Salon A'))) = 0,
  'Bob : journal d''audit de A invisible');
select tests.ok(tests.count(format('select * from public.profiles where id = %L', tests.uid('alice'))) = 0,
  'Bob : profil d''Alice (autre entreprise) invisible');

select tests.ok(tests.affected(format('update public.companies set name = %L where id = %L', 'Piraté', tests.company('Salon A'))) = 0,
  'Bob : modification de l''entreprise A sans effet');
select tests.ok(tests.affected(format('update public.establishments set name = %L where company_id = %L', 'Piraté', tests.company('Salon A'))) = 0,
  'Bob : modification d''un établissement de A sans effet');
select tests.ok(tests.affected(format('delete from public.staff_members where company_id = %L', tests.company('Salon A'))) = 0,
  'Bob : suppression des collaborateurs de A sans effet');
select tests.ok(tests.affected(format('delete from public.memberships where company_id = %L', tests.company('Salon A'))) = 0,
  'Bob : suppression des membres de A sans effet');
select tests.ok(tests.affected(format('delete from public.establishments where company_id = %L', tests.company('Salon A'))) = 0,
  'Bob : suppression des établissements de A sans effet');

select tests.throws(format($$insert into public.establishments (company_id, name, country_code) values (%L, 'Intrus', 'FR')$$, tests.company('Salon A')),
  'Bob : création d''un établissement dans A refusée', '42501');
select tests.throws(format($$insert into public.staff_members (company_id, establishment_id, display_name, job) values (%L, %L, 'Intrus', 'stylist')$$,
  tests.company('Salon A'), tests.establishment('Salon A')),
  'Bob : ajout d''un collaborateur dans A refusé', '42501');
select tests.throws(format($$insert into public.staff_members (company_id, establishment_id, display_name, job) values (%L, %L, 'Intrus', 'stylist')$$,
  tests.company('Salon B'), tests.establishment('Salon A')),
  'Bob : collaborateur de B rattaché à un établissement de A refusé (RLS par établissement)', '42501');
select tests.throws(format($$insert into public.memberships (company_id, user_id, role) values (%L, %L, 'owner')$$,
  tests.company('Salon A'), tests.uid('bob')),
  'Bob : auto-adhésion à A refusée', '42501');
select tests.throws(format($$update public.establishments set company_id = %L where company_id = %L$$,
  tests.company('Salon A'), tests.company('Salon B')),
  'Bob : transfert d''un établissement vers A refusé', '42501');
select tests.throws(format($$update public.staff_members set user_id = %L where company_id = %L$$,
  tests.uid('alice'), tests.company('Salon B')),
  'Bob : lier un compte de A à un collaborateur de B refusé', '23503');
select tests.ok(public.my_permissions(tests.company('Salon A')) = '{}', 'Bob : aucune permission sur A');
select tests.throws(format($$select public.delete_company(%L, 'Salon A')$$, tests.company('Salon A')),
  'Bob : suppression de l''entreprise A refusée', '42501');
select tests.ok(public.export_my_data()::text not like '%Salon A%', 'Bob : export RGPD sans aucune donnée de A');
reset role;

-- Vérification finale côté serveur : A est intacte.
select tests.ok((select name from public.companies where id = tests.company('Salon A')) = 'Salon A', 'A : nom inchangé');
select tests.ok((select count(*) from public.staff_members where company_id = tests.company('Salon A')) = 5, 'A : collaborateurs intacts');
select tests.ok((select count(*) from public.memberships where company_id = tests.company('Salon A')) = 4, 'A : membres intacts');
select tests.ok((select count(*) from public.establishments where company_id = tests.company('Salon A')) = 1, 'A : établissement intact');

-- ----------------------------------------------- symétrie : Alice attaque B --
set local role authenticated;
select tests.authenticate_as('alice');
select tests.ok(tests.count(format('select * from public.companies where id = %L', tests.company('Salon B'))) = 0, 'Alice : entreprise B invisible');
select tests.ok(tests.count(format('select * from public.staff_members where company_id = %L', tests.company('Salon B'))) = 0, 'Alice : collaborateurs de B invisibles');
select tests.ok(tests.affected(format('update public.staff_members set display_name = %L where company_id = %L', 'X', tests.company('Salon B'))) = 0,
  'Alice : modification des collaborateurs de B sans effet');
reset role;

rollback;
