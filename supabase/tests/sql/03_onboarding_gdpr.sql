\o /dev/null
-- Création de salon, limites anti-abus et droits RGPD.
begin;
select tests.seed();

-- Création de salon : propriétaire associé automatiquement.
select tests.ok((select role from public.memberships where user_id = tests.uid('alice') and company_id = tests.company('Salon A')) = 'owner',
  'création : le créateur devient owner');
select tests.ok((select count(*) from public.staff_members where user_id = tests.uid('alice')) = 1,
  'création : le créateur figure dans l''équipe de l''établissement');
select tests.ok((select display_name from public.profiles where id = tests.uid('alice')) = 'Alice',
  'inscription : profil créé automatiquement');

set local role authenticated;
select tests.authenticate_as('bob');
select tests.throws($$select public.create_company_with_establishment('Salon Z', 'Z', 'spa', 'FR', null, 'Mars/Olympus', 'fr', 'EUR')$$,
  'création : fuseau horaire invalide refusé', '22023');
select tests.throws($$select public.create_company_with_establishment('Z', 'Salon Z', 'spa', 'FR', null, 'Europe/Paris', 'fr', 'EUR')$$,
  'création : nom trop court refusé', '23514');
select tests.throws($$select public.create_company_with_establishment('Salon Z', 'Salon Z', 'spa', 'FR', null, 'Europe/Paris', 'xx', 'EUR')$$,
  'création : langue non prise en charge refusée', '23514');
select public.create_company_with_establishment('Salon B' || i, 'Etab', 'spa', 'FR', null, 'Europe/Paris', 'fr', 'EUR') from generate_series(2, 5) i;
select tests.throws($$select public.create_company_with_establishment('Salon B6', 'Etab', 'spa', 'FR', null, 'Europe/Paris', 'fr', 'EUR')$$,
  'anti-abus : 6e entreprise refusée', 'P0001');

-- Export RGPD
select tests.ok((public.export_my_data() ->> 'email') = 'bob@test.example', 'export RGPD : contient l''e-mail du demandeur');
select tests.ok(jsonb_array_length(public.export_my_data() -> 'memberships') = 5, 'export RGPD : liste ses adhésions');
reset role;

-- Droit à l'effacement
set local role authenticated;
select tests.authenticate_as('alice');
select tests.throws('select public.delete_my_account()', 'effacement : refusé tant qu''Alice est seule owner', 'P0001');
select tests.throws(format($$select public.delete_company(%L, 'Mauvais nom')$$, tests.company('Salon A')),
  'suppression d''entreprise : confirmation du nom exigée', '22023');
reset role;

set local role authenticated;
select tests.authenticate_as('carol');
select tests.lives('select public.delete_my_account()', 'effacement : un membre peut supprimer son compte');
reset role;
select tests.ok(not exists (select 1 from auth.users where email = 'carol@test.example'), 'effacement : compte supprimé');
select tests.ok(not exists (select 1 from public.profiles where display_name = 'Carol'), 'effacement : profil supprimé');
select tests.ok(not exists (select 1 from public.memberships m where m.user_id not in (select id from auth.users)), 'effacement : adhésions supprimées');

set local role authenticated;
select tests.authenticate_as('alice');
select tests.lives(format($$select public.delete_company(%L, 'Salon A')$$, tests.company('Salon A')),
  'owner : suppression complète de son entreprise');
reset role;
select tests.ok(not exists (select 1 from public.companies where name = 'Salon A'), 'suppression : entreprise effacée');
select tests.ok(not exists (select 1 from public.staff_members s where s.display_name = 'Collaborateur A1'), 'suppression : collaborateurs effacés');
select tests.ok(not exists (select 1 from public.audit_log a where a.company_id not in (select id from public.companies)), 'suppression : journal effacé');
select tests.ok(exists (select 1 from public.companies where name = 'Salon B'), 'suppression : l''entreprise B n''est pas affectée');

rollback;
