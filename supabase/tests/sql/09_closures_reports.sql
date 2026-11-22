\o /dev/null
-- Caisse V0.5 : clôture Z, factures, documents, rapports, exports, intégrité.
begin;
select tests.seed();
select tests.seed_clients();

create function tests.sale(p_amount_method text, p_extra jsonb default '{}')
returns jsonb language sql as $$
  select public.complete_sale(jsonb_build_object(
    'establishment_id', tests.establishment('Salon A'), 'session_id', current_setting('t.sess'), 'idempotency_key', gen_random_uuid(),
    'lines', jsonb_build_array(jsonb_build_object('kind', 'service', 'service_id', tests.service('Coupe'), 'quantity', 1,
                                                  'staff_id', tests.staff('Carol'))),
    'payments', jsonb_build_array(jsonb_build_object('method_id', tests.method('Salon A', p_amount_method), 'amount_cents', 3200))) || p_extra);
$$;
grant execute on all functions in schema tests to authenticated;

set local role authenticated;
select tests.authenticate_as('carol');
select set_config('t.sess', public.open_register(tests.register(tests.establishment('Salon A')), 10000)::text, true);
select set_config('t.s1', (tests.sale('cash') ->> 'sale_id'), true);
select tests.sale('card');
select tests.authenticate_as('erin');
select tests.sale('card');
select public.add_cash_movement(current_setting('t.sess')::uuid, 'out', 1000, 'Achat fournitures');
select public.refund_sale(jsonb_build_object('original_sale_id', current_setting('t.s1'), 'session_id', current_setting('t.sess'),
  'idempotency_key', gen_random_uuid(), 'reason', 'Geste commercial',
  'payments', jsonb_build_array(jsonb_build_object('method_id', tests.method('Salon A', 'cash'), 'amount_cents', 3200))));

-- --- Factures ------------------------------------------------------------------------------------
select tests.authenticate_as('carol');
select tests.throws(format($$select public.issue_invoice(%L, '{"name":"X"}')$$, current_setting('t.s1')), 'facture : nom de l''acheteur obligatoire', '22023');
select tests.throws(format($$select public.issue_invoice(%L, '{"name":"Société Fictive","email":"a@b.example"}')$$, current_setting('t.s1')),
  'facture : minimisation (champs hors liste refusés)', '22023');
select set_config('t.inv', public.issue_invoice(current_setting('t.s1')::uuid,
  '{"name":"Société Fictive SAS","address":"1 rue de l''Exemple, 69000 Lyon","vat_number":"FR00999999999"}') ->> 'document_no', true);
select tests.ok(current_setting('t.inv') like 'F-____-000001', 'facture nominative numérotée (série F)');
select tests.ok((public.issue_invoice(current_setting('t.s1')::uuid, '{"name":"Autre nom"}') ->> 'replayed')::boolean,
  'une seule facture par ticket');

-- --- Documents (PDF) -------------------------------------------------------------------------------
select set_config('t.doc', public.get_document('receipt', current_setting('t.s1')::uuid)::text, true);
select tests.ok((current_setting('t.doc')::jsonb ->> 'fiscal_mode') = 'uncertified'
  and (current_setting('t.doc')::jsonb ->> 'duplicate')::boolean = false
  and jsonb_array_length(current_setting('t.doc')::jsonb -> 'lines') = 1
  and (current_setting('t.doc')::jsonb -> 'taxes' -> 0 ->> 'tax_cents')::int = 533, 'reçu : lignes, TVA par taux, mode non certifié');
select tests.ok((public.get_document('receipt', current_setting('t.s1')::uuid) ->> 'duplicate')::boolean, 'réimpression marquée DUPLICATA');
select tests.ok((public.get_document('invoice', current_setting('t.s1')::uuid) -> 'buyer' ->> 'name') = 'Société Fictive SAS', 'facture : instantané de l''acheteur');
select tests.authenticate_as('bob');
select tests.throws(format('select public.get_document(%L, %L)', 'receipt', current_setting('t.s1')), 'isolation : document d''une autre entreprise refusé', '42501');

-- --- Rapports (D6) ---------------------------------------------------------------------------------
select tests.authenticate_as('carol');
select tests.ok((select (r ->> 'scope') = 'own' and (r ->> 'total_cents')::int = 6400
                 from public.sales_report(tests.establishment('Salon A'), current_date - 1, current_date + 1) r),
  'D6 : rapport du collaborateur limité à ses propres ventes');
select tests.throws(format($$select public.export_accounting(%L, current_date - 1, current_date + 1, 'csv')$$, tests.establishment('Salon A')),
  'export réservé (accounting.export)', '42501');
select tests.authenticate_as('erin');
select tests.ok((select (r ->> 'scope') = 'establishment' and (r ->> 'total_cents')::int = 6400 and (r ->> 'refunds_cents')::int = -3200
                 and (r ->> 'count_sales')::int = 3 from public.sales_report(tests.establishment('Salon A'), current_date - 1, current_date + 1) r),
  'rapport responsable : 3 ventes − 1 avoir = 64,00 €');

-- --- Clôture Z ------------------------------------------------------------------------------------------
select tests.authenticate_as('carol');
select tests.throws(format('select public.close_register(%L, 5000)', current_setting('t.sess')),
  'écart de caisse sans justification refusé', '22023');
-- Attendu : 100 (fond) + 32 (espèces) − 32 (avoir espèces) − 10 (sortie) = 90,00 €
select set_config('t.z', public.close_register(current_setting('t.sess')::uuid, 8950, '{"5000":1,"2000":2}', 'Erreur de rendu')::text, true);
select tests.ok((current_setting('t.z')::jsonb ->> 'expected_cents')::int = 9000 and (current_setting('t.z')::jsonb ->> 'difference_cents')::int = -50,
  'Z : espèces attendues calculées (fond + espèces − avoir − sortie), écart −0,50 €');
select tests.ok((current_setting('t.z')::jsonb ->> 'document_no') like 'Z-____-000001', 'Z numéroté');
select tests.ok((select status = 'closed' and difference_reason = 'Erreur de rendu' from public.register_sessions where id = current_setting('t.sess')::uuid),
  'session clôturée, écart justifié');
select tests.throws($$select tests.sale('card')$$, 'aucune vente après clôture', 'P0001');
select tests.throws(format('select public.close_register(%L, 9000)', current_setting('t.sess')), 'clôture unique', 'P0001');
select tests.ok(tests.count('select 1 from public.closures') = 1, 'D6 : le collaborateur voit le Z de sa session');
reset role;
-- F14 : totaux identiques entre ticket Z, rapport et export.
set local role authenticated;
select tests.authenticate_as('alice');
select tests.ok((select (c.totals ->> 'total_cents')::int = (r ->> 'total_cents')::int and (c.totals ->> 'tax_cents')::int = (r ->> 'tax_cents')::int
                 from public.closures c, public.sales_report(tests.establishment('Salon A'), current_date - 1, current_date + 1) r),
  'F14 : totaux du Z = totaux du rapport');
select set_config('t.csv', public.export_accounting(tests.establishment('Salon A'), current_date - 1, current_date + 1, 'csv')::text, true);
select tests.ok((current_setting('t.csv')::jsonb ->> 'rows')::int = 4 and position('Bernard' in current_setting('t.csv')::jsonb ->> 'content') = 0,
  'export CSV : 4 pièces, aucune donnée personnelle');
select set_config('t.fec', public.export_accounting(tests.establishment('Salon A'), current_date - 1, current_date + 1, 'fec') ->> 'content', true);
select tests.ok((select sum(replace(split_part(l, '|', 12), ',', '.')::numeric) = sum(replace(split_part(l, '|', 13), ',', '.')::numeric)
                   and sum(replace(split_part(l, '|', 13), ',', '.')::numeric) > 0
                 from unnest(string_to_array(rtrim(current_setting('t.fec'), E'\r\n'), E'\r\n')) with ordinality as t(l, n) where n > 1),
  'FEC : écritures équilibrées (Σ débit = Σ crédit)');
select tests.ok(split_part(current_setting('t.fec'), E'\r\n', 1) like 'JournalCode|JournalLib|EcritureNum|EcritureDate|CompteNum|%|Idevise',
  'FEC : 18 colonnes réglementaires');
select tests.ok(position('|706000|' in current_setting('t.fec')) > 0 and position('|445710|' in current_setting('t.fec')) > 0
  and position('|530000|' in current_setting('t.fec')) > 0, 'FEC : comptes de produits, TVA collectée, caisse');
select tests.ok(tests.count('select 1 from public.export_batches') = 2, 'chaque export est enregistré (empreinte, auteur)');

-- --- Clôtures de période -----------------------------------------------------------------------------
select tests.throws(format($$select public.close_period(%L, 'month', current_date)$$, tests.establishment('Salon A')),
  'clôture mensuelle impossible avant la fin du mois', 'P0001');
select tests.lives(format($$select public.close_period(%L, 'month', (current_date - interval '1 month')::date)$$, tests.establishment('Salon A')),
  'clôture du mois précédent');
select tests.throws(format($$select public.close_period(%L, 'month', (current_date - interval '1 month')::date)$$, tests.establishment('Salon A')),
  'clôture mensuelle unique', 'P0001');
select tests.ok((select (r ->> 'ok')::boolean and (r -> 'closures' ->> 'documents')::int = 2 and (r -> 'journal' ->> 'entries')::int > 10
                 from public.verify_integrity(tests.establishment('Salon A')) r), 'intégrité : ventes, clôtures et journal chaînés');
select tests.authenticate_as('carol');
select tests.throws(format($$select public.close_period(%L, 'month', (current_date - interval '2 month')::date)$$, tests.establishment('Salon A')),
  'D6 : clôture de période réservée', '42501');
select tests.ok(tests.count('select 1 from public.accounting_accounts') = 0 and tests.count('select 1 from public.export_batches') = 0,
  'plan de comptes et exports invisibles au collaborateur');
reset role;

-- Falsification d'une clôture puis du journal → détectée.
alter table public.closures disable trigger closures_immutable;
update public.closures set total_cents = total_cents + 100 where kind = 'z';
alter table public.closures enable trigger closures_immutable;
alter table public.fiscal_journal disable trigger fiscal_journal_immutable;
update public.fiscal_journal set payload = '{"x":1}' where id = (select min(id) + 2 from public.fiscal_journal);
alter table public.fiscal_journal enable trigger fiscal_journal_immutable;
set local role authenticated;
select tests.authenticate_as('alice');
select tests.ok((select not (r ->> 'ok')::boolean and (r -> 'closures' ->> 'first_broken') like 'Z-%' and (r -> 'journal' ->> 'first_broken') is not null
                 from public.verify_integrity(tests.establishment('Salon A')) r), 'falsification d''une clôture et du journal détectée');
-- Paramètres fiscaux : modification journalisée.
update public.fiscal_profiles set seller_legal_name = 'Salon A SARL (fictif)' where establishment_id = tests.establishment('Salon A');
select tests.ok(exists (select 1 from public.fiscal_journal where event = 'settings.fiscal_changed' and payload -> 'fields' ? 'seller_legal_name'),
  'changement de paramètres fiscaux journalisé');
reset role;

rollback;
