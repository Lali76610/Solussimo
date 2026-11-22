\o /dev/null
-- Données de santé (D1, D3) : activation légale, habilitation, consentement, chiffrement, journal.
begin;
select tests.seed();
select tests.seed_clients();

set local role authenticated;
select tests.authenticate_as('alice');
select tests.throws(format($$select public.set_client_health_notes(%L, '{"allergies":"x"}')$$, tests.client('Léa')),
  'D1 : désactivé par défaut → accès refusé', '42501');
reset role;
set local role authenticated;
select tests.authenticate_as('dave');
select tests.throws(format('select public.set_health_data_enabled(%L, true, true, true, true)', tests.company('Salon A')),
  'D1 : seul le propriétaire active la fonction', '42501');
select tests.authenticate_as('alice');
select tests.throws(format('select public.set_health_data_enabled(%L, true, true, false, true)', tests.company('Salon A')),
  'D1 : activation impossible sans les 3 vérifications légales', 'P0001');
select tests.lives(format('select public.set_health_data_enabled(%L, true, true, true, true)', tests.company('Salon A')),
  'D1 : activation après vérifications légales (consentement, AIPD, information)');
select tests.throws(format($$select public.set_client_health_notes(%L, '{"allergies":"arachide"}')$$, tests.client('Léa')),
  'consentement explicite obligatoire avant toute saisie', 'P0001');
reset role;

set local role authenticated;
select tests.authenticate_as('carol');
select tests.lives(format($$insert into public.client_consents (company_id, client_id, purpose, channel, status, method) values (%L, %L, 'health_data', 'none', 'granted', 'in_salon_signed')$$,
  tests.company('Salon A'), tests.client('Léa')), 'consentement santé explicite recueilli (signé)');
select tests.throws(format($$select public.set_client_health_notes(%L, '{"allergies":"arachide"}')$$, tests.client('Léa')),
  'collaborateur non habilité : écriture refusée', '42501');
select tests.throws(format('select public.get_client_health_notes(%L)', tests.client('Léa')), 'collaborateur non habilité : lecture refusée', '42501');
select tests.throws('select client_id from public.client_health_notes', 'aucune lecture directe de la table santé', '42501');
select tests.throws('select decrypted_secret from vault.decrypted_secrets', 'D3 : clé de chiffrement inaccessible', '42501');
reset role;

set local role authenticated;
select tests.authenticate_as('alice');
select tests.lives(format($$select public.set_client_health_notes(%L, '{"allergies":"arachide","pregnancy":false,"contraindications":"aucune connue"}')$$,
  tests.client('Léa')), 'owner : saisie des données de santé');
select tests.throws(format($$select public.set_client_health_notes(%L, '{"diagnostic":"x"}')$$, tests.client('Léa')),
  'minimisation : champs hors liste refusés', '22023');
select tests.throws(format($$select public.set_client_health_notes(%L, '{"pregnancy":"oui"}')$$, tests.client('Léa')),
  'minimisation : types contrôlés', '22023');
select tests.ok((public.get_client_health_notes(tests.client('Léa')) ->> 'allergies') = 'arachide', 'lecture déchiffrée par une personne habilitée');
select tests.lives(format('update public.staff_members set health_practitioner = true where user_id = %L', tests.uid('carol')),
  'owner : habilite un praticien de soins');
reset role;

select tests.ok((select position('arachide' in encode(ciphertext, 'escape')) = 0 and key_name = 'solussimo_health_key_v1'
                 from public.client_health_notes where client_id = tests.client('Léa')),
  'D3 : stocké chiffré (aucun texte en clair en base), clé identifiée pour la rotation');
select tests.throws($$select extensions.pgp_sym_decrypt(ciphertext, 'mauvaise-cle') from public.client_health_notes$$,
  'D3 : indéchiffrable sans la bonne clé');

set local role authenticated;
select tests.authenticate_as('carol');
select tests.ok((public.get_client_health_notes(tests.client('Léa')) ->> 'contraindications') = 'aucune connue', 'praticien habilité : lecture autorisée');
select tests.throws(format('select public.get_client_health_notes(%L)', tests.client('Nina')), 'praticien : client d''un autre établissement refusé', '42501');
select tests.authenticate_as('bob');
select tests.throws(format('select public.get_client_health_notes(%L)', tests.client('Léa')), 'autre entreprise : refusé', '42501');
reset role;

select tests.ok((select count(*) from public.client_access_log where action = 'health_read') >= 2
  and (select count(*) from public.client_access_log where action = 'health_write') >= 1, 'chaque accès santé est journalisé (sans contenu)');

-- Retrait du consentement ⇒ effacement immédiat.
set local role authenticated;
select tests.authenticate_as('carol');
select tests.lives(format($$insert into public.client_consents (company_id, client_id, purpose, channel, status) values (%L, %L, 'health_data', 'none', 'withdrawn')$$,
  tests.company('Salon A'), tests.client('Léa')), 'retrait du consentement santé');
select tests.throws(format('select public.get_client_health_notes(%L)', tests.client('Léa')), 'après retrait : lecture refusée', 'P0001');
reset role;
select tests.ok(not exists (select 1 from public.client_health_notes where client_id = tests.client('Léa')), 'retrait : données de santé effacées');
select tests.ok(exists (select 1 from public.client_access_log where action = 'health_erase'), 'retrait : effacement journalisé');

-- Désactivation ⇒ purge.
set local role authenticated;
select tests.authenticate_as('alice');
insert into public.client_consents (company_id, client_id, purpose, channel, status) values (tests.company('Salon A'), tests.client('Léa'), 'health_data', 'none', 'granted');
select public.set_client_health_notes(tests.client('Léa'), '{"allergies":"latex"}');
select public.set_health_data_enabled(tests.company('Salon A'), false);
reset role;
select tests.ok(not exists (select 1 from public.client_health_notes where company_id = tests.company('Salon A'))
  and not (select health_data_enabled from public.companies where id = tests.company('Salon A')), 'désactivation : toutes les données de santé purgées');

rollback;
