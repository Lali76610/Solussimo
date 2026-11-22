#!/usr/bin/env bash
# Base jetable « solussimo_e2e » (PostgreSQL LOCAL, données fictives) pour les tests navigateur.
# NE JAMAIS pointer vers une base réelle : la base est supprimée puis recréée.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ADMIN="${DATABASE_URL:-postgres://postgres@localhost:54329/postgres}"
URL="${ADMIN%/*}/solussimo_e2e"
P=(psql -X -q -v ON_ERROR_STOP=1)
"${P[@]}" "$ADMIN" -c "drop database if exists solussimo_e2e with (force)" -c "create database solussimo_e2e"
"${P[@]}" "$URL" -f "$ROOT/supabase/tests/support/00_supabase_stub.sql" >/dev/null
for f in "$ROOT"/supabase/migrations/*.sql; do "${P[@]}" "$URL" -f "$f" >/dev/null; done
"${P[@]}" "$URL" -f "$ROOT/supabase/tests/support/01_test_helpers.sql" >/dev/null
"${P[@]}" "$URL" >/dev/null <<'SQL'
select tests.seed();
select tests.seed_clients();
select set_config('request.jwt.claims', json_build_object('sub', tests.uid('alice'))::text, false);
update public.services set name = 'Coupe femme', price_cents = 4500 where name = 'Coupe';
insert into public.services (company_id, name, duration_minutes, price_cents) values
  (tests.company('Salon A'), 'Brushing', 30, 2800), (tests.company('Salon A'), 'Couleur', 90, 6500);
insert into public.products (company_id, name, price_cents) values (tests.company('Salon A'), 'Shampooing réparateur', 1800);
update public.fiscal_profiles set seller_legal_name = 'Salon A SARL (fictif)', seller_tax_id = '000000000',
  seller_address = '1 rue de l''Exemple, 69000 Lyon', legal_mentions = 'Société fictive — données de démonstration.'
  where establishment_id = tests.establishment('Salon A');
select public.set_staff_week_schedule(tests.staff('Carol'), tests.establishment('Salon A'),
  (select jsonb_agg(jsonb_build_object('weekday', d, 'start', '06:00', 'end', '23:00')) from generate_series(1, 7) d));
select public.book_appointment(tests.establishment('Salon A'), tests.staff('Carol'), tests.service('Coupe femme'),
  ((now() at time zone 'Europe/Paris')::date + time '22:00')::timestamp, null, null, tests.client('Léa'));
select set_config('request.jwt.claims', '', false);
SQL
echo "E2E_DB_READY"
