\o /dev/null
-- Module Clients : isolation, D2 (masquage), D4, recherche, doublons, consentements,
-- fusion (D7), export, anonymisation, conservation (D6), lien planning.
begin;
select tests.seed();
select tests.seed_clients();

-- ------------------------------------------------------------ staff (Carol, Centre) --
set local role authenticated;
select tests.authenticate_as('carol');
select tests.lives(format($$insert into public.clients (company_id, home_establishment_id, first_name) values (%L, %L, 'Solo') returning id$$,
  tests.company('Salon A'), tests.establishment('Salon A')), 'D4 : fiche avec un prénom seul (avec RETURNING, comme l''API)');
select tests.lives(format($$insert into public.clients (company_id, home_establishment_id, last_name) values (%L, %L, 'Seulnom')$$,
  tests.company('Salon A'), tests.establishment('Salon A')), 'D4 : fiche avec un nom seul');
select tests.throws(format($$insert into public.clients (company_id, home_establishment_id, email) values (%L, %L, 'x@exemple.example')$$,
  tests.company('Salon A'), tests.establishment('Salon A')), 'D4 : ni prénom ni nom refusé', '23514');
select tests.throws(format($$insert into public.clients (company_id, home_establishment_id, first_name) values (%L, %L, 'Intrus')$$,
  tests.company('Salon A'), tests.establishment_named('Salon A Nord')), 'staff : création dans un établissement non affecté refusée', '42501');
select tests.throws(format($$insert into public.clients (company_id, home_establishment_id, first_name, birthday_month) values (%L, %L, 'X', 2)$$,
  tests.company('Salon A'), tests.establishment('Salon A')), 'D5 : jour ET mois ensemble', '23514');
select tests.ok(tests.count(format('select id from public.clients where id = %L', tests.client('Léa'))) = 1, 'staff : voit les clients de son établissement');
select tests.ok(tests.count(format('select id from public.clients where id = %L', tests.client('Nina'))) = 0, 'staff : client d''un autre établissement invisible');
select tests.throws('select email from public.clients', 'D2 : e-mail en clair illisible via l''API', '42501');
select tests.throws('select phone_e164 from public.clients', 'D2 : téléphone en clair illisible via l''API', '42501');
select tests.throws('select search_text from public.clients', 'D2 : texte de recherche (contient les coordonnées) illisible', '42501');
select tests.ok((select email_masked = 'l•••@exemple.example' and phone_masked = '+33 •• •• 00 01' from public.clients where id = tests.client('Léa')),
  'D2 : coordonnées masquées lisibles (l•••@…, +33 •• •• 00 01)');
select tests.throws(format('select * from public.reveal_client_contact(%L)', tests.client('Léa')), 'D2 : un collaborateur ne peut pas afficher les coordonnées complètes', '42501');
select tests.throws(format($$select * from public.search_clients(%L, '')$$, tests.company('Salon A')), 'staff : recherche vide refusée (anti-aspiration)', '22023');
select tests.ok((select count(*) from public.search_clients(tests.company('Salon A'), 'lea')) = 1, 'recherche « lea » (sans accent) → Léa');
select tests.ok((select count(*) from public.search_clients(tests.company('Salon A'), 'bernrd')) = 1, 'recherche tolérante aux fautes (« bernrd »)');
select tests.ok((select count(*) from public.search_clients(tests.company('Salon A'), '0639980001')) = 1, 'recherche par numéro au format national');
select tests.ok((select count(*) from public.search_clients(tests.company('Salon A'), 'nina')) = 0, 'recherche : aucun résultat hors établissements autorisés');
select tests.lives(format($$insert into public.client_consents (company_id, client_id, purpose, channel, status) values (%L, %L, 'marketing', 'sms', 'granted')$$,
  tests.company('Salon A'), tests.client('Léa')), 'consentement marketing SMS recueilli au comptoir');
select tests.throws($$update public.client_consents set status = 'withdrawn'$$, 'consentements : modification interdite (ajout seul)', '42501');
select tests.throws($$delete from public.client_consents$$, 'consentements : suppression interdite (ajout seul)', '42501');
select tests.lives(format($$insert into public.client_consents (company_id, client_id, purpose, channel, status) values (%L, %L, 'marketing', 'sms', 'withdrawn')$$,
  tests.company('Salon A'), tests.client('Léa')), 'retrait du consentement en un geste');
select tests.ok((select status from public.client_consent_status where client_id = tests.client('Léa') and purpose = 'marketing' and channel = 'sms') = 'withdrawn'
  and tests.count(format('select id from public.client_consents where client_id = %L', tests.client('Léa'))) = 2, 'consentement : état courant « retiré », historique complet (2 événements)');
select tests.throws(format($$insert into public.client_consents (company_id, client_id, purpose, channel, status) values (%L, %L, 'health_data', 'none', 'granted')$$,
  tests.company('Salon A'), tests.client('Léa')), 'D1 : consentement santé impossible tant que la fonction est désactivée', 'P0001');
select tests.lives(format($$insert into public.client_technical_notes (client_id, company_id, kind, content) values (%L, %L, 'color_formula', 'Coloration 6.3 + oxydant 20 vol.')$$,
  tests.client('Léa'), tests.company('Salon A')), 'fiche technique (formule de coloration)');
select tests.lives(format($$insert into public.client_favorite_services (client_id, service_id, company_id) values (%L, %L, %L)$$,
  tests.client('Léa'), tests.service('Coupe'), tests.company('Salon A')), 'prestation habituelle enregistrée');
select tests.throws(format($$select public.export_client_data(%L)$$, tests.client('Léa')), 'staff : export réservé owner/admin', '42501');
select tests.throws(format($$select public.erase_client(%L, true)$$, tests.client('Léa')), 'staff : effacement réservé owner/admin', '42501');
select tests.throws(format($$select public.merge_clients(%L, %L)$$, tests.client('Léa'), tests.client('Solo')), 'staff : fusion interdite (D7)', '42501');
select tests.ok(tests.affected(format($$update public.staff_members set health_practitioner = true where user_id = %L$$, tests.uid('carol'))) = 0,
  'D1 : un collaborateur ne peut pas s''habiliter (0 ligne)');
reset role;

-- --------------------------------------------------- manager (Erin, Centre) --------
set local role authenticated;
select tests.authenticate_as('erin');
select tests.throws(format($$update public.staff_members set health_practitioner = true where user_id = %L$$, tests.uid('erin')),
  'D1 : un responsable ne peut pas s''auto-habiliter aux données de santé', '42501');
select tests.ok((select email = 'lea@exemple.example' and phone_e164 = '+33639980001' from public.reveal_client_contact(tests.client('Léa'))),
  'D2 : un responsable affiche les coordonnées complètes (permission serveur)');
select tests.throws(format('select * from public.reveal_client_contact(%L)', tests.client('Nina')), 'D2 : pas d''accès aux coordonnées d''un autre établissement', '42501');
select tests.throws(format($$insert into public.clients (company_id, home_establishment_id, first_name, email) values (%L, %L, 'Copie', 'lea@exemple.example')$$,
  tests.company('Salon A'), tests.establishment('Salon A')), 'e-mail unique par entreprise', '23505');
select tests.lives(format($$insert into public.clients (company_id, home_establishment_id, first_name, last_name, phone_e164) values (%L, %L, 'Lea', 'Bernart', '+33639980009')$$,
  tests.company('Salon A'), tests.establishment('Salon A')), 'création d''un doublon probable (orthographe différente)');
select tests.ok((select max(score) from public.find_duplicate_candidates(tests.company('Salon A'), 'Léa', 'Bernard', null, null)) >= 60
  and (select count(*) from public.find_duplicate_candidates(tests.company('Salon A'), 'Léa', 'Bernard', null, null)) = 2,
  'doublons détectés par similarité du nom');
select tests.ok((select score from public.find_duplicate_candidates(tests.company('Salon A'), null, null, 'LEA@exemple.example', null) limit 1) >= 100,
  'doublon détecté par e-mail (insensible à la casse)');
select tests.lives(format($$select public.book_appointment(%L, %L, %L, '2026-12-07 10:00', null, null, %L)$$,
  tests.establishment('Salon A'), tests.staff('Collaborateur A1'), tests.service('Coupe'), tests.client('Lea')), 'réservation liée à une fiche client');
select tests.ok((select client_label from public.appointments where client_id = tests.client('Lea')) = 'Lea B.', 'libellé du rendez-vous déduit de la fiche (« Lea B. »)');
select tests.lives(format($$select public.book_appointment(%L, %L, %L, '2026-12-07 11:00', 'Client de passage')$$,
  tests.establishment('Salon A'), tests.staff('Collaborateur A1'), tests.service('Coupe')), 'D4 : client de passage sans fiche');
select tests.throws(format($$select public.book_appointment(%L, %L, %L, '2026-12-07 12:00')$$,
  tests.establishment('Salon A'), tests.staff('Collaborateur A1'), tests.service('Coupe')), 'réservation sans client ni libellé refusée', '22023');
select tests.throws(format($$select public.book_appointment(%L, %L, %L, '2026-12-07 12:00', null, null, %L)$$,
  tests.establishment('Salon A'), tests.staff('Collaborateur A1'), tests.service('Coupe'), tests.client('Bruno')), 'réservation avec un client d''une autre entreprise refusée', 'P0001');
select tests.lives(format($$insert into public.client_consents (company_id, client_id, purpose, channel, status) values (%L, %L, 'marketing', 'email', 'granted')$$,
  tests.company('Salon A'), tests.client('Léa')), 'Léa : marketing e-mail accepté');
select tests.lives(format($$insert into public.client_consents (company_id, client_id, purpose, channel, status) values (%L, %L, 'marketing', 'email', 'withdrawn')$$,
  tests.company('Salon A'), tests.client('Lea')), 'doublon : marketing e-mail retiré');
select tests.throws(format($$select public.merge_clients(%L, %L)$$, tests.client('Léa'), tests.client('Nina')), 'D7 : fusion avec une fiche d''un autre établissement refusée', '42501');
select tests.ok(public.merge_clients(tests.client('Léa'), tests.client('Lea'), '{"phone_e164": false}') = tests.client('Léa'), 'D7 : fusion par un responsable dans son établissement');
reset role;
select tests.ok((select status = 'anonymized' and first_name is null from public.clients where merged_into = tests.client('Léa')), 'fusion : doublon anonymisé et rattaché');
select tests.ok((select count(*) from public.appointments where client_id = tests.client('Léa')) = 1, 'fusion : rendez-vous du doublon repris (aucune perte)');
select tests.ok((select status from public.client_consent_status where client_id = tests.client('Léa') and purpose = 'marketing' and channel = 'email') = 'withdrawn',
  'fusion : le consentement le plus restrictif l''emporte');
select tests.ok(exists (select 1 from public.client_access_log where action = 'merge' and actor_id = tests.uid('erin')), 'fusion journalisée');
select tests.ok(exists (select 1 from public.client_access_log where action = 'contact_reveal' and actor_id = tests.uid('erin')), 'D2 : affichage des coordonnées journalisé');

-- ------------------------------------------------------------------- Bob (B) ------
set local role authenticated;
select tests.authenticate_as('bob');
select tests.ok(tests.count(format('select id from public.clients where company_id = %L', tests.company('Salon A'))) = 0, 'Bob : clients de A invisibles');
select tests.throws(format($$select * from public.search_clients(%L, 'lea')$$, tests.company('Salon A')), 'Bob : recherche dans A refusée', '42501');
select tests.throws(format('select * from public.reveal_client_contact(%L)', tests.client('Léa')), 'Bob : coordonnées d''un client de A refusées', '42501');
select tests.throws(format($$select * from public.find_duplicate_candidates(%L, null, null, 'lea@exemple.example')$$, tests.company('Salon A')),
  'Bob : sonder l''existence d''un e-mail chez A refusé', '42501');
select tests.ok(tests.affected(format($$update public.clients set first_name = 'Piraté' where id = %L$$, tests.client('Léa'))) = 0, 'Bob : modification d''un client de A sans effet');
select tests.throws(format($$insert into public.clients (company_id, home_establishment_id, first_name) values (%L, %L, 'Intrus')$$,
  tests.company('Salon A'), tests.establishment('Salon A')), 'Bob : création dans A refusée', '42501');
select tests.throws(format($$insert into public.client_consents (company_id, client_id, purpose, channel, status) values (%L, %L, 'marketing', 'sms', 'granted')$$,
  tests.company('Salon A'), tests.client('Léa')), 'Bob : consentement sur un client de A refusé', '42501');
select tests.ok(tests.count(format('select id from public.client_technical_notes where company_id = %L', tests.company('Salon A'))) = 0, 'Bob : fiches techniques de A invisibles');
select tests.throws(format($$select public.export_client_data(%L)$$, tests.client('Léa')), 'Bob : export d''un client de A refusé', '42501');
select tests.throws(format($$select public.erase_client(%L, true)$$, tests.client('Léa')), 'Bob : effacement d''un client de A refusé', '42501');
select tests.throws(format($$select public.merge_clients(%L, %L)$$, tests.client('Bruno'), tests.client('Léa')), 'Bob : fusion inter-entreprises refusée', '42501');
reset role;

-- ------------------------------------------------------- owner / admin -------------
set local role authenticated;
select tests.authenticate_as('alice');
select tests.ok((select count(*) from public.search_clients(tests.company('Salon A'), '')) >= 4, 'owner : liste complète (sans critère)');
create temporary table exp on commit drop as select public.export_client_data(tests.client('Léa')) as j;
select tests.ok((select j -> 'client' ->> 'email' from exp) = 'lea@exemple.example'
  and jsonb_array_length((select j -> 'appointments' from exp)) = 1
  and jsonb_array_length((select j -> 'consents' from exp)) >= 4
  and (select j -> 'client' ->> 'birthday' from exp) = '14/03', 'export RGPD complet (coordonnées, rendez-vous, consentements, anniversaire jour/mois)');
select tests.ok((select count(*) from public.search_clients(tests.company('Salon A'), '', null, null, null, null, false, 500)) <= 50, 'recherche plafonnée à 50 résultats');
select tests.throws(format($$select public.erase_client(%L, false)$$, tests.client('Léa')), 'effacement : confirmation obligatoire', '22023');
create temporary table erased on commit drop as select tests.client('Léa') as id;
select public.erase_client((select id from erased), true);
reset role;
select tests.ok((select status = 'anonymized' and first_name is null and email is null and phone_e164 is null and tags = '{}'
                 from public.clients where id = (select id from erased)), 'effacement : fiche anonymisée (plus aucune donnée identifiante)');
select tests.ok((select client_label from public.appointments where client_id = (select id from erased)) = '—', 'effacement : rendez-vous conservés pour la comptabilité');
select tests.ok(not exists (select 1 from public.client_technical_notes where client_id = (select id from erased)), 'effacement : fiche technique supprimée');
select tests.ok(exists (select 1 from public.client_access_log where action = 'export') and exists (select 1 from public.client_access_log where action = 'erase'),
  'export et effacement journalisés');
set local role authenticated;
select tests.authenticate_as('alice');
select tests.lives(format($$insert into public.clients (company_id, home_establishment_id, first_name, email) values (%L, %L, 'Nouvelle', 'lea@exemple.example')$$,
  tests.company('Salon A'), tests.establishment('Salon A')), 'effacement : l''adresse e-mail est libérée');
reset role;

-- D6 : réexamen sans suppression automatique, réglages par entreprise.
update public.clients set created_at = now() - interval '40 months' where last_name = 'Seulnom';
set local role authenticated;
select tests.authenticate_as('carol');
select tests.throws(format('select * from public.clients_to_review(%L)', tests.company('Salon A')), 'D6 : réexamen réservé owner/admin', '42501');
select tests.authenticate_as('alice');
select tests.ok((select count(*) from public.clients_to_review(tests.company('Salon A')) where last_name = 'Seulnom') = 1, 'D6 : fiche inactive depuis plus de 36 mois proposée au réexamen');
select tests.ok(exists (select 1 from public.clients where last_name = 'Seulnom'), 'D6 : aucune suppression automatique');
select tests.lives(format('select public.set_retention_settings(%L, 24, 10)', tests.company('Salon A')), 'D6 : durée de réexamen paramétrable (24 mois)');
select tests.throws(format('select public.set_retention_settings(%L, 6, 10)', tests.company('Salon A')), 'D6 : bornes de conservation contrôlées', '23514');
reset role;
select tests.ok((select accounting_retention_years from public.companies where id = tests.company('Salon B')) = 6
  and (select accounting_retention_years from public.companies where id = tests.company('Salon A')) = 10,
  'D6 : conservation comptable par défaut selon le pays (ES 6 ans, FR 10 ans)');

rollback;
