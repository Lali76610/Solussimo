\o /dev/null
-- Module Personnel : affectations multi-établissements, horaires, absences, invitations.
begin;
select tests.seed();

-- Second établissement de A + un collaborateur affecté uniquement à celui-ci.
select set_config('request.jwt.claims', json_build_object('sub', tests.uid('alice'))::text, true);
insert into public.establishments (company_id, name, country_code, timezone)
values (tests.company('Salon A'), 'Salon A Nord', 'FR', 'Europe/Paris');
insert into public.staff_members (company_id, establishment_id, display_name, job)
values (tests.company('Salon A'), tests.establishment_named('Salon A Nord'), 'Collaborateur Nord', 'beautician');
select tests.clear_authentication();

-- ------------------------------------------------------------- owner (Alice) --
set local role authenticated;
select tests.authenticate_as('alice');
-- Comme l'application (PostgREST) : INSERT … RETURNING exige que la nouvelle ligne soit lisible.
select tests.lives(format($$insert into public.staff_members (company_id, establishment_id, display_name, job) values (%L, %L, 'Créé avec retour', 'stylist') returning id$$,
  tests.company('Salon A'), tests.establishment('Salon A')), 'owner : création avec RETURNING (comme l''API)');
select tests.lives(format($$insert into public.staff_establishments (staff_id, establishment_id, company_id) values (%L, %L, %L)$$,
  tests.staff('Collaborateur A1'), tests.establishment_named('Salon A Nord'), tests.company('Salon A')),
  'owner : affecte un collaborateur à un second établissement');
select tests.ok(tests.count(format('select * from public.staff_establishments where staff_id = %L', tests.staff('Collaborateur A1'))) = 2,
  'collaborateur affecté à 2 établissements');
select tests.throws(format($$delete from public.staff_establishments where staff_id = %L and establishment_id = %L$$,
  tests.staff('Collaborateur A1'), tests.establishment('Salon A')),
  'impossible de retirer l''établissement principal', '23514');
select tests.ok(tests.affected(format($$update public.staff_members set jobs = '{stylist,colorist}', bookable = false where id = %L$$,
  tests.staff('Collaborateur A1'))) = 1, 'owner : fonctions multiples + disponibilité à la réservation');
select tests.ok((select jobs @> '{colorist,stylist}' and jobs <@ '{colorist,stylist}' from public.staff_members where id = tests.staff('Collaborateur A1')),
  'fonctions multiples enregistrées');
select tests.lives(format($$select public.set_staff_week_schedule(%L, %L, '[{"weekday":1,"start":"09:00","end":"12:30"},{"weekday":1,"start":"13:30","end":"19:00"},{"weekday":2,"start":"09:00","end":"19:00"}]')$$,
  tests.staff('Collaborateur A1'), tests.establishment('Salon A')), 'owner : horaires hebdomadaires avec pause');
select tests.ok(tests.count(format('select * from public.staff_working_hours where staff_id = %L', tests.staff('Collaborateur A1'))) = 3,
  'horaires : 3 plages enregistrées (pause = intervalle libre)');
select tests.throws(format($$select public.set_staff_week_schedule(%L, %L, '[{"weekday":1,"start":"09:00","end":"12:00"},{"weekday":1,"start":"11:00","end":"15:00"}]')$$,
  tests.staff('Collaborateur A1'), tests.establishment('Salon A')), 'horaires : plages qui se chevauchent refusées', '23P01');
select tests.throws(format($$select public.set_staff_week_schedule(%L, %L, '[{"weekday":1,"start":"12:00","end":"09:00"}]')$$,
  tests.staff('Collaborateur A1'), tests.establishment('Salon A')), 'horaires : fin avant début refusée', '23514');
select tests.throws(format($$select public.set_staff_week_schedule(%L, %L, '[]')$$,
  tests.staff('Collaborateur B1'), tests.establishment('Salon B')), 'owner A : horaires d''un collaborateur de B refusés', '42501');
reset role;

-- --------------------------------------------------- manager (Erin, Centre) --
set local role authenticated;
select tests.authenticate_as('erin');
select tests.ok(tests.count(format('select * from public.establishments where id = %L', tests.establishment_named('Salon A Nord'))) = 0,
  'manager : établissement non affecté invisible');
select tests.ok(tests.count(format('select * from public.staff_members where id = %L', tests.staff('Collaborateur Nord'))) = 0,
  'manager : collaborateur d''un autre établissement invisible');
select tests.throws(format($$insert into public.staff_members (company_id, establishment_id, display_name, job) values (%L, %L, 'Intrus', 'stylist')$$,
  tests.company('Salon A'), tests.establishment_named('Salon A Nord')), 'manager : création dans un établissement non affecté refusée', '42501');
select tests.lives(format($$insert into public.staff_members (company_id, establishment_id, display_name, job) values (%L, %L, 'Recrue Centre', 'apprentice') returning id$$,
  tests.company('Salon A'), tests.establishment('Salon A')), 'manager : crée un collaborateur dans son établissement');
select tests.lives(format($$select public.set_staff_week_schedule(%L, %L, '[{"weekday":3,"start":"10:00","end":"18:00"}]')$$,
  tests.staff('Recrue Centre'), tests.establishment('Salon A')), 'manager : définit les horaires dans son établissement');
select tests.throws(format($$select public.set_staff_week_schedule(%L, %L, '[]')$$,
  tests.staff('Collaborateur A1'), tests.establishment_named('Salon A Nord')), 'manager : horaires dans un établissement non affecté refusés', '42501');
select tests.ok(tests.affected(format($$delete from public.staff_establishments where staff_id = %L and establishment_id = %L$$,
  tests.staff('Collaborateur A1'), tests.establishment_named('Salon A Nord'))) = 0, 'manager : ne peut pas désaffecter d''un établissement non affecté');
select tests.lives(format($$insert into public.staff_time_off (company_id, staff_id, kind, starts_at, ends_at) values (%L, %L, 'vacation', '2026-12-21 00:00+01', '2026-12-27 00:00+01')$$,
  tests.company('Salon A'), tests.staff('Collaborateur A1')), 'manager : enregistre des congés');
select tests.throws(format($$insert into public.staff_time_off (company_id, staff_id, kind, starts_at, ends_at) values (%L, %L, 'absence', '2026-12-02 10:00+01', '2026-12-01 10:00+01')$$,
  tests.company('Salon A'), tests.staff('Collaborateur A1')), 'absence : fin avant début refusée', '23514');
select tests.throws(format($$select public.create_invitation(%L, 'x@test.example', 'staff')$$, tests.company('Salon A')),
  'manager : ne peut pas inviter', '42501');
reset role;

-- --------------------------------------------------------------- staff (Carol) --
set local role authenticated;
select tests.authenticate_as('carol');
select tests.ok(tests.count('select * from public.establishments') = 1, 'staff : ne voit que son établissement');
select tests.ok(tests.affected(format($$update public.staff_members set bookable = true where id = %L$$, tests.staff('Collaborateur A1'))) = 0,
  'staff : ne peut pas modifier une fiche');
select tests.throws(format($$insert into public.staff_time_off (company_id, staff_id, kind, starts_at, ends_at) values (%L, %L, 'absence', now(), now() + interval '1 day')$$,
  tests.company('Salon A'), tests.staff('Collaborateur A1')), 'staff : ne peut pas créer d''absence', '42501');
select tests.throws(format($$select public.set_staff_week_schedule(%L, %L, '[]')$$, tests.staff('Collaborateur A1'), tests.establishment('Salon A')),
  'staff : ne peut pas modifier les horaires', '42501');
select tests.ok(tests.count('select id, email from public.invitations') = 0, 'staff : aucune invitation visible');
reset role;

-- ----------------------------------------------------------------- Bob (B) ----
set local role authenticated;
select tests.authenticate_as('bob');
select tests.ok(tests.count(format('select * from public.staff_time_off where company_id = %L', tests.company('Salon A'))) = 0, 'Bob : absences de A invisibles');
select tests.ok(tests.count(format('select * from public.staff_working_hours where company_id = %L', tests.company('Salon A'))) = 0, 'Bob : horaires de A invisibles');
select tests.ok(tests.count(format('select * from public.staff_establishments where company_id = %L', tests.company('Salon A'))) = 0, 'Bob : affectations de A invisibles');
select tests.throws(format($$insert into public.staff_establishments (staff_id, establishment_id, company_id) values (%L, %L, %L)$$,
  tests.staff('Collaborateur B1'), tests.establishment('Salon A'), tests.company('Salon A')), 'Bob : affectation croisée vers A refusée', '42501');
select tests.throws(format($$select public.create_invitation(%L, 'x@test.example', 'staff')$$, tests.company('Salon A')),
  'Bob : invitation dans A refusée', '42501');
reset role;

-- --------------------------------------------------------------- Invitations ----
-- Fiche à rattacher + comptes fictifs de l'invité et d'un tiers.
select set_config('request.jwt.claims', json_build_object('sub', tests.uid('alice'))::text, true);
insert into public.staff_members (company_id, establishment_id, display_name, job)
values (tests.company('Salon A'), tests.establishment('Salon A'), 'Nouvelle Recrue', 'stylist');
select tests.clear_authentication();
select tests.create_user('newbie', 'Newbie');
select tests.create_user('unconfirmed', 'Pas confirmé');
update auth.users set email_confirmed_at = null where email = 'unconfirmed@test.example';

set local role authenticated;
select tests.authenticate_as('dave');
select tests.throws(format($$select public.create_invitation(%L, 'x@test.example', 'admin')$$, tests.company('Salon A')),
  'admin : ne peut pas inviter un admin', '42501');
select tests.throws(format($$select public.create_invitation(%L, 'x@test.example', 'owner')$$, tests.company('Salon A')),
  'invitation d''un owner impossible', '42501');
select tests.throws(format($$select public.create_invitation(%L, 'carol@test.example', 'staff')$$, tests.company('Salon A')),
  'invitation d''un membre existant refusée', '23505');
select tests.throws(format($$select public.create_invitation(%L, 'x@test.example', 'staff', %L)$$, tests.company('Salon A'), tests.staff('Collaborateur B1')),
  'invitation liée à une fiche d''une autre entreprise refusée', '22023');
reset role;

set local role authenticated;
select tests.authenticate_as('alice');
create temporary table inv on commit drop as
  select * from public.create_invitation(tests.company('Salon A'), 'NewBie@Test.example', 'staff', tests.staff('Nouvelle Recrue'));
create temporary table inv_expired on commit drop as
  select * from public.create_invitation(tests.company('Salon A'), 'unconfirmed@test.example', 'staff');
select tests.ok(length((select token from inv)) = 64, 'invitation : jeton aléatoire de 256 bits renvoyé une seule fois');
select tests.ok((select expires_at from inv) between now() + interval '71 hours' and now() + interval '73 hours', 'invitation : valable 72 h');
select tests.ok((select email from public.invitations where id = (select invitation_id from inv)) = 'newbie@test.example', 'invitation : e-mail normalisé');
select tests.throws('select token_hash from public.invitations', 'invitation : hachage du jeton illisible', '42501');
reset role;

grant select on inv, inv_expired to authenticated;

-- Mauvais compte, mauvais jeton, e-mail non confirmé.
set local role authenticated;
select tests.authenticate_as('bob');
select tests.ok((select status from public.get_invitation((select token from inv))) = 'pending', 'invitation : consultable par le porteur du lien');
select tests.throws('select public.accept_invitation((select token from inv))', 'invitation : refusée pour un autre compte', '42501');
select tests.authenticate_as('newbie');
select tests.throws($$select public.accept_invitation('0000000000000000000000000000000000000000000000000000000000000000')$$,
  'invitation : jeton inconnu refusé', '22023');
select tests.authenticate_as('unconfirmed');
select tests.throws('select public.accept_invitation((select token from inv_expired))', 'invitation : e-mail non confirmé refusé', '42501');
reset role;

-- Acceptation valide, puis réutilisation.
set local role authenticated;
select tests.authenticate_as('newbie');
select tests.ok(public.accept_invitation((select token from inv)) = tests.company('Salon A'), 'invitation : acceptée par le bon compte');
select tests.ok((select role from public.memberships where user_id = tests.uid('newbie')) = 'staff', 'invitation : rôle attribué');
select tests.ok((select user_id from public.staff_members where id = tests.staff('Nouvelle Recrue')) = tests.uid('newbie'), 'invitation : fiche collaborateur liée au compte');
select tests.ok(tests.count('select * from public.establishments') = 1, 'nouveau membre : voit uniquement son établissement');
select tests.throws('select public.accept_invitation((select token from inv))', 'invitation : usage unique', '22023');
reset role;

-- Expiration et révocation.
update public.invitations set expires_at = now() - interval '1 minute' where id = (select invitation_id from inv_expired);
update auth.users set email_confirmed_at = now() where email = 'unconfirmed@test.example';
set local role authenticated;
select tests.authenticate_as('unconfirmed');
select tests.throws('select public.accept_invitation((select token from inv_expired))', 'invitation : expirée refusée', '22023');
select tests.authenticate_as('alice');
create temporary table inv_revoked on commit drop as
  select * from public.create_invitation(tests.company('Salon A'), 'revoked@test.example', 'manager');
select public.revoke_invitation((select invitation_id from inv_revoked));
select tests.ok((select revoked_at is not null from public.invitations where id = (select invitation_id from inv_revoked)), 'invitation : révoquée');
reset role;
grant select on inv_revoked to authenticated;
select tests.create_user('revoked', 'Révoqué');
set local role authenticated;
select tests.authenticate_as('revoked');
select tests.throws('select public.accept_invitation((select token from inv_revoked))', 'invitation : révoquée refusée', '22023');
reset role;

rollback;
