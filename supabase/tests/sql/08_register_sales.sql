\o /dev/null
-- Caisse V0.5 : encaissement serveur, remises plafonnées, paiements, idempotence,
-- numérotation continue, inaltérabilité, chaînage, avoirs, acomptes, isolation.
begin;
select tests.seed();
select tests.seed_clients();

-- Fabrique d'un encaissement (session courante, clé d'idempotence neuve sauf si fournie).
create function tests.sale(p_lines jsonb, p_payments jsonb, p_extra jsonb default '{}')
returns jsonb language sql as $$
  select public.complete_sale(jsonb_build_object(
    'establishment_id', tests.establishment('Salon A'), 'session_id', current_setting('t.sess'),
    'idempotency_key', gen_random_uuid()) || p_extra || jsonb_build_object('lines', p_lines, 'payments', p_payments));
$$;
create function tests.coupe(p_extra jsonb default '{}')
returns jsonb language sql as $$ select jsonb_build_array(jsonb_build_object('kind', 'service', 'service_id', tests.service('Coupe'), 'quantity', 1) || p_extra); $$;
create function tests.cash(p_amount bigint, p_tendered bigint default null)
returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('method_id', tests.method('Salon A', 'cash'), 'amount_cents', p_amount)
         || case when p_tendered is null then '{}'::jsonb else jsonb_build_object('tendered_cents', p_tendered) end);
$$;
create function tests.card(p_amount bigint, p_ref text default null)
returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('method_id', tests.method('Salon A', 'card'), 'amount_cents', p_amount, 'external_ref', p_ref));
$$;
grant execute on all functions in schema tests to authenticated;

-- --- Paramètres par défaut -------------------------------------------------------------------
select tests.ok((select fiscal_mode = 'uncertified' and currency = 'EUR' and country_code = 'FR' from public.fiscal_profiles
                 where establishment_id = tests.establishment('Salon A')), 'D1 : profil fiscal créé en mode non certifié');
select tests.ok((select count(*) = 1 from public.cash_registers where establishment_id = tests.establishment('Salon A')),
  'une caisse par défaut par établissement');
select tests.throws($$update public.fiscal_profiles set fiscal_mode = 'certified'$$, 'D1 : mode certifié impossible', '23514');
select tests.ok((select rate_bp from public.tax_rates t join public.companies c on c.id = t.company_id
                 where c.name = 'Salon B' and t.code = 'standard') = 2100, 'ES : TVA standard 21 %');
select tests.ok(exists (select 1 from public.payment_methods m join public.companies c on c.id = m.company_id
                        where c.name = 'Salon B' and m.label = 'Bizum'), 'ES : moyen local Bizum');

-- --- Ouverture de caisse ---------------------------------------------------------------------
set local role authenticated;
select tests.authenticate_as('bob');
select tests.throws(format('select public.open_register(%L, 10000)', tests.register(tests.establishment('Salon A'))),
  'autre entreprise : ouverture refusée', '42501');
select tests.authenticate_as('carol');
select set_config('t.sess', public.open_register(tests.register(tests.establishment('Salon A')), 15000,
  '{"2000":5,"1000":5}')::text, true);
select tests.ok(current_setting('t.sess') <> '', 'D6 : un collaborateur ouvre la caisse');
select tests.throws(format('select public.open_register(%L, 0)', tests.register(tests.establishment('Salon A'))),
  'une seule session ouverte par caisse', 'P0001');
select tests.throws(format($$select public.add_cash_movement(%L, 'out', 500, 'Fournitures')$$, current_setting('t.sess')),
  'D6 : mouvement d''espèces refusé au collaborateur', '42501');
select tests.throws('insert into public.sales (company_id) values (gen_random_uuid())', 'aucune écriture directe des ventes', '42501');

-- --- Encaissement simple, prix et taxes calculés côté serveur -----------------------------------
select set_config('t.key', gen_random_uuid()::text, true);
select set_config('t.s1', (tests.sale(tests.coupe('{"unit_price_cents": 1}'), tests.cash(3200, 5000),
  jsonb_build_object('idempotency_key', current_setting('t.key'), 'client_id', tests.client('Léa'))) ->> 'sale_id'), true);
select tests.ok((select total_cents = 3200 and tax_cents = 533 and net_cents = 2667 and document_no like 'T-____-000001'
                 from public.sales where id = current_setting('t.s1')::uuid),
  'prix du catalogue imposé (prix navigateur ignoré), TVA 20 % extraite du TTC, numéro T-…-000001');
select tests.ok((select change_cents = 1800 and tendered_cents = 5000 from public.sale_payments where sale_id = current_setting('t.s1')::uuid),
  'rendu monnaie en espèces calculé');
select tests.ok((tests.sale(tests.coupe(), tests.cash(3200), jsonb_build_object('idempotency_key', current_setting('t.key'))) ->> 'replayed')::boolean
  and (select count(*) from public.sales) = 1, 'idempotence : même clé → même ticket, aucun doublon');

select tests.throws($$select tests.sale(tests.coupe(), tests.cash(3000))$$, 'Σ paiements ≠ total refusé', 'P0001');
select tests.throws($$select tests.sale(tests.coupe(), jsonb_build_array(jsonb_build_object('method_id', tests.method('Salon A', 'card'), 'amount_cents', 3200, 'tendered_cents', 4000)))$$,
  'rendu monnaie interdit hors espèces', '22023');
select tests.throws($$select tests.sale(tests.coupe(), tests.card(3200, '4970101234567890'))$$,
  'aucun numéro de carte stocké (référence terminal uniquement)', '22023');
select tests.lives($$select tests.sale(tests.coupe(), tests.cash(1200) || tests.card(2000, 'AUT-4821'))$$, 'paiement mixte espèces + carte');
select tests.throws($$select tests.sale('[{"kind":"custom","label":"Libre","unit_price_cents":100,"quantity":1}]', tests.cash(100))$$,
  'ligne libre réservée aux responsables', '42501');
select tests.throws(format($$select tests.sale(jsonb_build_array(jsonb_build_object('kind','service','service_id',%L,'quantity',1)), tests.cash(100))$$,
  gen_random_uuid()), 'prestation inconnue refusée', '22023');

-- --- Remises (D5) ---------------------------------------------------------------------------
select tests.throws($$select tests.sale(tests.coupe('{"discount_bp": 1000}'), tests.cash(2880))$$, 'remise : motif obligatoire', '22023');
select tests.lives($$select tests.sale(tests.coupe('{"discount_bp": 1000}'), tests.cash(2880), '{"discount_reason":"Fidélité"}')$$,
  'collaborateur : remise 10 % autorisée');
select tests.ok((tests.sale(tests.coupe(), tests.cash(2400), '{"ticket_discount_bp":2500,"discount_reason":"Geste"}') ->> 'error')
  = 'discount_approval_required', 'collaborateur : remise 25 % sans code refusée (aucune vente créée)');
reset role;
set local role authenticated;
select tests.authenticate_as('erin');
select tests.throws(format('select public.create_discount_approval(%L, 5000)', tests.establishment('Salon A')),
  'responsable : ne peut approuver au-delà de son propre plafond (30 %)', 'P0001');
select set_config('t.code', (select code from public.create_discount_approval(tests.establishment('Salon A'), 2500)), true);
select tests.authenticate_as('carol');
select tests.throws('select code_hash from public.discount_approvals', 'codes d''approbation illisibles', '42501');
select tests.lives(format($$select tests.sale(tests.coupe(), tests.cash(2400), '{"ticket_discount_bp":2500,"discount_reason":"Geste","approval_code":"%s"}')$$,
  current_setting('t.code')), 'remise 25 % approuvée par code responsable');
select tests.ok((tests.sale(tests.coupe(), tests.cash(2400), jsonb_build_object('ticket_discount_bp', 2500, 'discount_reason', 'Geste',
  'approval_code', current_setting('t.code'))) ->> 'error') = 'discount_approval_required', 'code d''approbation à usage unique');
select tests.ok((select bool_and((tests.sale(tests.coupe(), tests.cash(2400), '{"ticket_discount_bp":2500,"discount_reason":"Geste","approval_code":"00000000"}') ->> 'error') is not null)
                 from generate_series(1, 4)), 'codes erronés successifs');
select tests.throws($$select tests.sale(tests.coupe(), tests.cash(2400), '{"ticket_discount_bp":2500,"discount_reason":"Geste","approval_code":"12345678"}')$$,
  'force brute : blocage après 5 codes erronés en 15 min', 'P0001');
reset role;
select tests.ok((select discount_approved_by = tests.uid('erin') and discount_cents = 800 from public.sales where discount_approved_by is not null),
  'traçabilité : approbateur et montant de remise enregistrés');

-- --- Numérotation continue malgré les échecs -------------------------------------------------------
select tests.ok((select array_agg(number order by number) = array[1,2,3,4] from public.sales where series = 'T'),
  'numérotation continue sans trou malgré les tentatives refusées');

-- --- Visibilité (D6) et isolation --------------------------------------------------------------------
set local role authenticated;
select tests.authenticate_as('erin');
select tests.lives($$select tests.sale(tests.coupe(), tests.card(3200))$$, 'responsable : encaissement');
select tests.authenticate_as('carol');
select tests.ok(tests.count('select 1 from public.sales') = 4, 'D6 : le collaborateur ne voit que ses propres ventes');
select tests.ok(tests.count('select 1 from public.fiscal_journal') = 0, 'D6 : journal fiscal invisible au collaborateur');
select tests.throws(format('select * from public.verify_fiscal_chain(%L)', tests.establishment('Salon A')), 'D6 : contrôle d''intégrité réservé', '42501');
select tests.authenticate_as('erin');
select tests.ok(tests.count('select 1 from public.sales') = 5, 'responsable : toutes les ventes de l''établissement');
select tests.ok(tests.count('select 1 from public.fiscal_journal') >= 6, 'journal fiscal : ouverture, approbation, ventes');
select tests.authenticate_as('bob');
select tests.ok(tests.count('select 1 from public.sales') = 0 and tests.count('select 1 from public.sale_lines') = 0
  and tests.count('select 1 from public.sale_payments') = 0, 'isolation : aucune vente d''une autre entreprise visible');
select tests.throws($$select tests.sale(tests.coupe(), tests.cash(3200))$$, 'isolation : encaissement dans une autre entreprise refusé', '42501');
reset role;

-- --- Inaltérabilité et chaînage -----------------------------------------------------------------------
select tests.throws(format('update public.sales set total_cents = 1 where id = %L', current_setting('t.s1')),
  'inaltérabilité : vente non modifiable (même par le propriétaire de la base)', '42501');
select tests.throws(format('delete from public.sale_lines where sale_id = %L', current_setting('t.s1')), 'inaltérabilité : lignes non supprimables', '42501');
select tests.throws('delete from public.fiscal_journal', 'inaltérabilité : journal non supprimable', '42501');
select tests.throws(format('delete from public.companies where id = %L', tests.company('Salon A')),
  'conservation : entreprise avec pièces comptables non supprimable', 'P0001');
set local role authenticated;
select tests.authenticate_as('alice');
select tests.ok((select documents = 5 and first_broken is null from public.verify_fiscal_chain(tests.establishment('Salon A'))),
  'chaîne SHA-256 intègre (5 pièces)');
reset role;
alter table public.sales disable trigger sales_immutable;
update public.sales set total_cents = 3100, net_cents = 2567 where id = current_setting('t.s1')::uuid;
alter table public.sales enable trigger sales_immutable;
set local role authenticated;
select tests.authenticate_as('alice');
select tests.ok((select first_broken like 'T-____-000001' from public.verify_fiscal_chain(tests.establishment('Salon A'))),
  'falsification détectée par le contrôle de chaîne');
reset role;
alter table public.sales disable trigger sales_immutable;
update public.sales set total_cents = 3200, net_cents = 2667 where id = current_setting('t.s1')::uuid;
alter table public.sales enable trigger sales_immutable;

-- --- Avoirs ----------------------------------------------------------------------------------------
set local role authenticated;
select tests.authenticate_as('carol');
select tests.throws(format($$select public.refund_sale(jsonb_build_object('original_sale_id', %L, 'session_id', %L,
  'idempotency_key', gen_random_uuid(), 'reason', 'Erreur', 'payments', tests.cash(3200)))$$, current_setting('t.s1'), current_setting('t.sess')),
  'D6 : remboursement refusé au collaborateur', '42501');
select tests.authenticate_as('erin');
select tests.throws(format($$select public.refund_sale(jsonb_build_object('original_sale_id', %L, 'session_id', %L,
  'idempotency_key', gen_random_uuid(), 'payments', tests.cash(3200)))$$, current_setting('t.s1'), current_setting('t.sess')),
  'avoir : motif obligatoire', '22023');
select set_config('t.a1', (public.refund_sale(jsonb_build_object('original_sale_id', current_setting('t.s1'), 'session_id', current_setting('t.sess'),
  'idempotency_key', gen_random_uuid(), 'reason', 'Client mécontent', 'payments', tests.cash(3200))) ->> 'document_no'), true);
select tests.ok(current_setting('t.a1') like 'A-____-000001', 'avoir numéroté dans sa propre série A');
select tests.ok((select total_cents = -3200 and tax_cents = -533 and original_sale_id = current_setting('t.s1')::uuid
                 from public.sales where document_no = current_setting('t.a1')), 'avoir : montants négatifs, lien vers le ticket d''origine');
select tests.throws(format($$select public.refund_sale(jsonb_build_object('original_sale_id', %L, 'session_id', %L,
  'idempotency_key', gen_random_uuid(), 'reason', 'Encore', 'payments', tests.cash(3200)))$$, current_setting('t.s1'), current_setting('t.sess')),
  'avoir plafonné au restant remboursable', 'P0001');
select tests.lives(format($$select public.add_cash_movement(%L, 'out', 500, 'Fournitures')$$, current_setting('t.sess')),
  'responsable : sortie d''espèces motivée');

-- --- Acomptes et rendez-vous ----------------------------------------------------------------------------
select tests.throws($$select tests.sale('[]', tests.card(1000), '{"kind":"deposit","deposit_amount_cents":1000}')$$,
  'acompte : client obligatoire', '22023');
select set_config('t.dep', (tests.sale('[]', tests.card(1000), jsonb_build_object('kind', 'deposit', 'deposit_amount_cents', 1000,
  'client_id', tests.client('Léa'))) ->> 'sale_id'), true);
select tests.ok((select document_no like 'D-____-000001' and tax_cents = 167 from public.sales where id = current_setting('t.dep')::uuid),
  'acompte : série D, TVA exigible à l''encaissement');
select set_config('t.appt', (select public.book_appointment(tests.establishment('Salon A'), tests.staff('Collaborateur A1'), tests.service('Coupe'),
  '2026-12-07 10:00', null, null, tests.client('Léa')))::text, true);
select set_config('t.s2', (tests.sale(tests.coupe(), tests.cash(2200), jsonb_build_object('appointment_id', current_setting('t.appt'),
  'deposit_ids', jsonb_build_array(current_setting('t.dep')))) ->> 'sale_id'), true);
select tests.ok((select total_cents = 2200 and client_id = tests.client('Léa') from public.sales where id = current_setting('t.s2')::uuid),
  'acompte imputé, client repris du rendez-vous');
select tests.ok((select status = 'completed' from public.appointments where id = current_setting('t.appt')::uuid), 'rendez-vous marqué réalisé');
select tests.throws(format($$select tests.sale(tests.coupe(), tests.cash(3200), jsonb_build_object('appointment_id', %L))$$, current_setting('t.appt')),
  'un rendez-vous n''est encaissé qu''une fois', 'P0001');
select tests.throws(format($$select tests.sale(tests.coupe(), tests.cash(2200), jsonb_build_object('client_id', %L, 'deposit_ids', jsonb_build_array(%L)))$$,
  tests.client('Léa'), current_setting('t.dep')), 'acompte imputé une seule fois', 'P0001');
select tests.throws(format($$select public.refund_sale(jsonb_build_object('original_sale_id', %L, 'session_id', %L,
  'idempotency_key', gen_random_uuid(), 'reason', 'x', 'payments', tests.card(1000)))$$, current_setting('t.dep'), current_setting('t.sess')),
  'acompte déjà imputé : non remboursable', 'P0001');
select tests.authenticate_as('alice');
select tests.ok((select documents = 8 and first_broken is null from public.verify_fiscal_chain(tests.establishment('Salon A'))),
  'chaîne intègre après avoirs et acomptes');
reset role;

rollback;
