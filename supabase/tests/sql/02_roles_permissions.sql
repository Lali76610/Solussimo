\o /dev/null
-- Rôles au sein d'une même entreprise : owner > admin > manager > staff.
begin;
select tests.seed();

-- ------------------------------------------------------------ staff (Carol) --
set local role authenticated;
select tests.authenticate_as('carol');
select tests.ok(tests.count('select * from public.companies') = 1, 'staff : voit son entreprise');
select tests.ok(tests.count('select * from public.staff_members') = 2, 'staff : voit l''équipe');
select tests.ok(tests.count('select * from public.audit_log') = 0, 'staff : pas d''accès au journal d''audit');
select tests.ok(tests.affected(format($$update public.companies set name = 'X' where id = %L$$, tests.company('Salon A'))) = 0,
  'staff : ne peut pas modifier l''entreprise');
select tests.throws(format($$insert into public.staff_members (company_id, establishment_id, display_name, job) values (%L, %L, 'Nouveau', 'stylist')$$,
  tests.company('Salon A'), tests.establishment('Salon A')), 'staff : ne peut pas ajouter de collaborateur', '42501');
select tests.ok(tests.affected(format($$update public.memberships set role = 'admin' where user_id = %L$$, tests.uid('carol'))) = 0,
  'staff : ne peut pas s''auto-promouvoir (0 ligne modifiée)');
select tests.ok(public.my_permissions(tests.company('Salon A')) = '{company.read}', 'staff : permissions = lecture seule');
reset role;

-- ---------------------------------------------------------- manager (Erin) --
set local role authenticated;
select tests.authenticate_as('erin');
select tests.lives(format($$insert into public.staff_members (company_id, establishment_id, display_name, job) values (%L, %L, 'Nouvelle recrue', 'apprentice')$$,
  tests.company('Salon A'), tests.establishment('Salon A')), 'manager : peut ajouter un collaborateur');
select tests.ok(tests.affected(format($$update public.establishments set name = 'X' where company_id = %L$$, tests.company('Salon A'))) = 0,
  'manager : ne peut pas modifier l''établissement');
select tests.ok(tests.affected(format($$update public.memberships set role = 'staff' where user_id = %L$$, tests.uid('dave'))) = 0,
  'manager : ne peut pas gérer les rôles');
reset role;

-- ------------------------------------------------------------ admin (Dave) --
set local role authenticated;
select tests.authenticate_as('dave');
select tests.ok(tests.affected(format($$update public.companies set name = 'Salon A Prestige' where id = %L$$, tests.company('Salon A'))) = 1,
  'admin : peut modifier l''entreprise');
select tests.lives(format($$insert into public.establishments (company_id, name, country_code) values (%L, 'Salon A Nord', 'FR')$$,
  tests.company('Salon A Prestige')), 'admin : peut créer un établissement');
select tests.ok(tests.affected(format($$update public.memberships set role = 'manager' where user_id = %L$$, tests.uid('carol'))) = 1,
  'admin : peut promouvoir un staff en manager');
select tests.throws(format($$update public.memberships set role = 'owner' where user_id = %L$$, tests.uid('carol')),
  'admin : ne peut pas nommer un owner', '42501');
select tests.throws(format($$update public.memberships set role = 'staff' where user_id = %L$$, tests.uid('alice')),
  'admin : ne peut pas rétrograder l''owner', '42501');
select tests.throws(format($$delete from public.memberships where user_id = %L$$, tests.uid('alice')),
  'admin : ne peut pas retirer l''owner', '42501');
select tests.throws(format($$update public.memberships set role = 'owner' where user_id = %L$$, tests.uid('dave')),
  'admin : ne peut pas s''auto-promouvoir owner', '42501');
select tests.ok(tests.affected(format($$delete from public.establishments where name = 'Salon A Nord'$$)) = 0,
  'admin : ne peut pas supprimer un établissement (réservé à l''owner)');
select tests.ok(tests.count('select * from public.audit_log') > 0, 'admin : lit le journal d''audit');
select tests.throws($$insert into public.audit_log (company_id, action, entity) select company_id, 'insert', 'fake' from public.audit_log limit 1$$,
  'admin : ne peut pas falsifier le journal d''audit', '42501');
select tests.throws(format($$select public.delete_company(%L, 'Salon A Prestige')$$, tests.company('Salon A Prestige')),
  'admin : ne peut pas supprimer l''entreprise', '42501');
reset role;

-- ----------------------------------------------------------- owner (Alice) --
set local role authenticated;
select tests.authenticate_as('alice');
select tests.ok(tests.count(format('select * from public.profiles where id = %L', tests.uid('dave'))) = 1,
  'owner : voit le profil de ses collègues');
select tests.ok(tests.affected(format($$update public.profiles set display_name = 'X' where id = %L$$, tests.uid('dave'))) = 0,
  'owner : ne peut pas modifier le profil d''un autre');
select tests.ok(tests.affected(format($$update public.profiles set display_name = 'Alice M.' where id = %L$$, tests.uid('alice'))) = 1,
  'chacun peut modifier son propre profil');
select tests.throws($$insert into public.companies (name, country_code) values ('Directe', 'FR')$$,
  'insertion directe dans companies refusée (RPC obligatoire)', '42501');
select tests.throws(format($$delete from public.memberships where user_id = %L$$, tests.uid('alice')),
  'le dernier owner ne peut pas quitter l''entreprise', '23514');
select tests.lives(format($$delete from public.establishments where name = 'Salon A Nord'$$),
  'owner : peut supprimer un établissement');
select tests.ok(public.my_permissions(tests.company('Salon A Prestige')) @> '{company.delete,audit.read,membership.manage}',
  'owner : dispose de toutes les permissions');
reset role;

rollback;
