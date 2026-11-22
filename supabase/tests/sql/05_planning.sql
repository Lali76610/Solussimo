\o /dev/null
-- Module Planning : prestations, disponibilités, doubles réservations, fuseaux, cabines.
begin;
select tests.seed();

set local role authenticated;
select tests.authenticate_as('alice');
-- Prestations
select tests.lives(format($$insert into public.services (company_id, name, duration_minutes, price_cents) values (%L, 'Coupe', 30, 3200), (%L, 'Coloration', 90, 6800), (%L, 'Soin visage', 60, 7000)$$,
  tests.company('Salon A'), tests.company('Salon A'), tests.company('Salon A')), 'owner : crée des prestations (durée + tarif)');
select tests.throws(format($$insert into public.services (company_id, name, duration_minutes) values (%L, 'Bizarre', 7)$$, tests.company('Salon A')),
  'prestation : durée non multiple de 5 refusée', '23514');
-- Horaires lundi–samedi 09:00–12:30 / 13:30–19:00 pour A1 et Erin (Centre).
select public.set_staff_week_schedule(tests.staff(n), tests.establishment('Salon A'),
  (select jsonb_agg(x) from generate_series(1, 6) d,
     lateral (values (jsonb_build_object('weekday', d, 'start', '09:00', 'end', '12:30')),
                     (jsonb_build_object('weekday', d, 'start', '13:30', 'end', '19:00'))) v(x)))
from unnest(array['Collaborateur A1', 'Erin']) n;
reset role;

-- ----------------------------------------------------------- réservations ----
set local role authenticated;
select tests.authenticate_as('alice');
-- Lundi 7 décembre 2026 (heure d'hiver, Paris = UTC+1)
create temporary table appt on commit drop as
  select public.book_appointment(tests.establishment('Salon A'), tests.staff('Collaborateur A1'), tests.service('Coupe'),
                                 '2026-12-07 10:00', 'Client fictif 1') as id;
select tests.ok((select starts_at from public.appointments where id = (select id from appt)) = '2026-12-07 09:00+00',
  'fuseau : 10:00 à Paris (hiver) enregistré 09:00 UTC');
select tests.ok((select ends_at - starts_at from public.appointments where id = (select id from appt)) = interval '30 minutes',
  'durée issue de la prestation');
select tests.ok((select price_cents from public.appointments where id = (select id from appt)) = 3200, 'tarif figé au moment de la réservation');
select tests.throws(format($$select public.book_appointment(%L, %L, %L, '2026-12-07 10:15', 'Doublon')$$,
  tests.establishment('Salon A'), tests.staff('Collaborateur A1'), tests.service('Coupe')), 'double réservation refusée', '23P01');
select tests.lives(format($$select public.book_appointment(%L, %L, %L, '2026-12-07 10:30', 'Client fictif 2')$$,
  tests.establishment('Salon A'), tests.staff('Collaborateur A1'), tests.service('Coupe')), 'créneau adjacent accepté');
select tests.throws(format($$select public.book_appointment(%L, %L, %L, '2026-12-07 12:15', 'Pause')$$,
  tests.establishment('Salon A'), tests.staff('Collaborateur A1'), tests.service('Coupe')), 'chevauchement de la pause refusé', 'P0001');
select tests.throws(format($$select public.book_appointment(%L, %L, %L, '2026-12-07 08:30', 'Tôt')$$,
  tests.establishment('Salon A'), tests.staff('Collaborateur A1'), tests.service('Coupe')), 'avant l''ouverture refusé', 'P0001');
select tests.throws(format($$select public.book_appointment(%L, %L, %L, '2026-12-06 10:00', 'Dimanche')$$,
  tests.establishment('Salon A'), tests.staff('Collaborateur A1'), tests.service('Coupe')), 'jour non travaillé refusé', 'P0001');
select tests.throws(format($$select public.book_appointment(%L, %L, %L, '2026-12-07 18:00', 'Trop long')$$,
  tests.establishment('Salon A'), tests.staff('Collaborateur A1'), tests.service('Coloration')), 'dépassement de l''heure de fermeture refusé', 'P0001');
select tests.throws(format($$select public.book_appointment(%L, %L, %L, '2026-12-07 10:00', 'Hors équipe')$$,
  tests.establishment('Salon A'), tests.staff('Collaborateur B1'), tests.service('Coupe')), 'collaborateur d''une autre entreprise refusé', 'P0001');
select tests.throws($$insert into public.appointments (company_id, establishment_id, staff_id, service_id, starts_at, ends_at, client_label, price_cents) values (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), now(), now() + interval '1 hour', 'X', 0)$$,
  'écriture directe dans appointments refusée', '42501');
reset role;

-- Congés et indisponibilité
set local role authenticated;
select tests.authenticate_as('alice');
insert into public.staff_time_off (company_id, staff_id, kind, starts_at, ends_at)
values (tests.company('Salon A'), tests.staff('Collaborateur A1'), 'vacation', '2026-12-14 00:00+01', '2026-12-19 00:00+01');
select tests.throws(format($$select public.book_appointment(%L, %L, %L, '2026-12-15 10:00', 'Congés')$$,
  tests.establishment('Salon A'), tests.staff('Collaborateur A1'), tests.service('Coupe')), 'réservation pendant les congés refusée', 'P0001');
update public.staff_members set bookable = false where id = tests.staff('Erin');
select tests.throws(format($$select public.book_appointment(%L, %L, %L, '2026-12-07 10:00', 'Non réservable')$$,
  tests.establishment('Salon A'), tests.staff('Erin'), tests.service('Coupe')), 'collaborateur non réservable refusé', 'P0001');
update public.staff_members set bookable = true where id = tests.staff('Erin');
update public.services set active = false where id = tests.service('Soin visage');
select tests.throws(format($$select public.book_appointment(%L, %L, %L, '2026-12-07 15:00', 'Inactif')$$,
  tests.establishment('Salon A'), tests.staff('Erin'), tests.service('Soin visage')), 'prestation désactivée refusée', 'P0001');
update public.services set active = true where id = tests.service('Soin visage');
reset role;

-- ------------------------------------------------- déplacement / annulation ----
set local role authenticated;
select tests.authenticate_as('alice');
select tests.ok(public.reschedule_appointment((select id from appt), '2026-12-07 15:00', 1) = 2, 'déplacement : nouvelle version');
select tests.ok((select starts_at from public.appointments where id = (select id from appt)) = '2026-12-07 14:00+00', 'déplacement : heure mise à jour');
select tests.throws(format($$select public.reschedule_appointment(%L, '2026-12-07 16:00', 1)$$, (select id from appt)),
  'concurrence optimiste : version périmée refusée (sans boucle de réessai)', 'P0001');
select tests.throws(format($$select public.reschedule_appointment(%L, '2026-12-07 10:30', 2)$$, (select id from appt)),
  'déplacement sur un créneau occupé refusé', '23P01');
select tests.ok(public.reschedule_appointment((select id from appt), '2026-12-07 15:00', 2, tests.staff('Erin')) = 3,
  'réaffectation à un autre collaborateur');
select public.cancel_appointment((select id from appt), 3);
select tests.ok((select status from public.appointments where id = (select id from appt)) = 'cancelled', 'annulation');
select tests.lives(format($$select public.book_appointment(%L, %L, %L, '2026-12-07 15:00', 'Client fictif 3')$$,
  tests.establishment('Salon A'), tests.staff('Erin'), tests.service('Coupe')), 'créneau annulé de nouveau disponible');
select tests.throws(format($$select public.cancel_appointment(%L, 4)$$, (select id from appt)), 'rendez-vous annulé non modifiable', 'P0001');
reset role;

-- --------------------------------------------------- changement d'heure (DST) ----
set local role authenticated;
select tests.authenticate_as('alice');
create temporary table b1 on commit drop as select public.book_appointment(tests.establishment('Salon A'), tests.staff('Collaborateur A1'), tests.service('Coupe'), '2027-03-27 10:00', 'Veille DST') as id;
select tests.ok((select a.starts_at from public.appointments a join b1 using (id)) = '2027-03-27 09:00+00',
  'DST : samedi 27/03/2027 10:00 Paris = 09:00 UTC (hiver)');
create temporary table b2 on commit drop as select public.book_appointment(tests.establishment('Salon A'), tests.staff('Collaborateur A1'), tests.service('Coupe'), '2027-03-29 10:00', 'Lendemain DST') as id;
select tests.ok((select a.starts_at from public.appointments a join b2 using (id)) = '2027-03-29 08:00+00',
  'DST : lundi 29/03/2027 10:00 Paris = 08:00 UTC (été)');
select tests.throws(format($$select public.book_appointment(%L, %L, %L, '2027-03-28 02:30', 'Heure inexistante')$$,
  tests.establishment('Salon A'), tests.staff('Collaborateur A1'), tests.service('Coupe')), 'DST : heure inexistante (02:30) refusée', '22008');
reset role;

-- Établissement dans un autre fuseau (New York)
select set_config('request.jwt.claims', json_build_object('sub', tests.uid('alice'))::text, true);
insert into public.establishments (company_id, name, country_code, timezone)
values (tests.company('Salon A'), 'Salon A New York', 'US', 'America/New_York');
insert into public.staff_establishments (staff_id, establishment_id, company_id)
values (tests.staff('Collaborateur A1'), tests.establishment_named('Salon A New York'), tests.company('Salon A'));
select public.set_staff_week_schedule(tests.staff('Collaborateur A1'), tests.establishment_named('Salon A New York'), '[{"weekday":7,"start":"09:00","end":"17:00"}]');
select tests.clear_authentication();
set local role authenticated;
select tests.authenticate_as('alice');
create temporary table b3 on commit drop as select public.book_appointment(tests.establishment_named('Salon A New York'), tests.staff('Collaborateur A1'), tests.service('Coupe'), '2026-12-13 10:00', 'Client NY') as id;
select tests.ok((select a.starts_at from public.appointments a join b3 using (id)) = '2026-12-13 15:00+00',
  'fuseau par établissement : 10:00 New York = 15:00 UTC');
reset role;

-- --------------------------------------------------------- cabines (ressources) ----
set local role authenticated;
select tests.authenticate_as('alice');
select tests.lives(format($$insert into public.resources (company_id, establishment_id, name, kind) values (%L, %L, 'Cabine 1', 'cabin')$$,
  tests.company('Salon A'), tests.establishment('Salon A')), 'owner : crée une cabine de soins');
create temporary table cab on commit drop as select id from public.resources where name = 'Cabine 1';
select tests.lives(format($$select public.book_appointment(%L, %L, %L, '2026-12-09 10:00', 'Soin 1', %L)$$,
  tests.establishment('Salon A'), tests.staff('Collaborateur A1'), tests.service('Soin visage'), (select id from cab)), 'réservation avec cabine');
select tests.throws(format($$select public.book_appointment(%L, %L, %L, '2026-12-09 10:30', 'Soin 2', %L)$$,
  tests.establishment('Salon A'), tests.staff('Erin'), tests.service('Soin visage'), (select id from cab)), 'cabine déjà occupée refusée', '23P01');
reset role;

-- --------------------------------------------------------- cloisonnement ----
set local role authenticated;
select tests.authenticate_as('carol');
select tests.lives(format($$select public.book_appointment(%L, %L, %L, '2026-12-10 11:00', 'Réservé par Carol')$$,
  tests.establishment('Salon A'), tests.staff('Erin'), tests.service('Coupe')), 'staff : réserve dans son établissement');
select tests.throws(format($$select public.book_appointment(%L, %L, %L, '2026-12-13 11:00', 'Hors établissement')$$,
  tests.establishment_named('Salon A New York'), tests.staff('Collaborateur A1'), tests.service('Coupe')), 'staff : établissement non affecté refusé', '42501');
select tests.ok(tests.count(format('select * from public.appointments where establishment_id = %L', tests.establishment_named('Salon A New York'))) = 0,
  'staff : rendez-vous d''un établissement non affecté invisibles');
select tests.throws(format($$insert into public.services (company_id, name, duration_minutes) values (%L, 'Pirate', 30)$$, tests.company('Salon A')),
  'staff : ne peut pas créer de prestation', '42501');
reset role;

set local role authenticated;
select tests.authenticate_as('bob');
select tests.ok(tests.count(format('select * from public.appointments where company_id = %L', tests.company('Salon A'))) = 0, 'Bob : rendez-vous de A invisibles');
select tests.ok(tests.count(format('select * from public.services where company_id = %L', tests.company('Salon A'))) = 0, 'Bob : prestations de A invisibles');
select tests.ok(tests.count(format('select * from public.resources where company_id = %L', tests.company('Salon A'))) = 0, 'Bob : cabines de A invisibles');
select tests.throws(format($$select public.book_appointment(%L, %L, %L, '2026-12-07 16:00', 'Intrus')$$,
  tests.establishment('Salon A'), tests.staff('Erin'), tests.service('Coupe')), 'Bob : réservation chez A refusée', '42501');
select tests.throws(format($$select public.cancel_appointment(%L, 1)$$, tests.appointment('Réservé par Carol')),
  'Bob : annulation d''un rendez-vous de A (identifiant connu) refusée', '42501');
select tests.throws(format($$select public.reschedule_appointment(%L, '2026-12-10 16:00', 1)$$, tests.appointment('Réservé par Carol')),
  'Bob : déplacement d''un rendez-vous de A refusé', '42501');
select tests.ok(tests.affected(format($$update public.services set price_cents = 0 where company_id = %L$$, tests.company('Salon A'))) = 0,
  'Bob : modification des tarifs de A sans effet');
reset role;

select tests.ok(exists (select 1 from public.appointments where client_label = 'Réservé par Carol'), 'rendez-vous de A intacts');
select tests.ok((select count(*) from public.audit_log where entity = 'appointments') >= 5, 'rendez-vous tracés dans le journal d''audit');

rollback;
