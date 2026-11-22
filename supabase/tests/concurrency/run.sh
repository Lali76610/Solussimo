#!/usr/bin/env bash
# Tests de CONCURRENCE (sessions PostgreSQL réellement parallèles).
# Usage interne : appelé par scripts/test-db.sh avec l'URL de la base de test jetable.
# Les données sont validées (COMMIT) : ne jamais lancer sur une base réelle.
set -euo pipefail
URL="$1"
PSQL=(psql -X -q -tA -v ON_ERROR_STOP=1 "$URL")
pass=0
ok() { if [[ "$1" == "true" ]]; then pass=$((pass + 1)); echo "     ok c$pass - $2"; else echo "✖ ÉCHEC: $2"; exit 1; fi; }

# --- Données fictives validées --------------------------------------------------------
"${PSQL[@]}" <<'SQL' >/dev/null
select tests.seed();
select set_config('request.jwt.claims', json_build_object('sub', tests.uid('alice'))::text, false);
insert into public.services (company_id, name, duration_minutes, price_cents) values (tests.company('Salon A'), 'Coupe', 30, 3200);
select public.set_staff_week_schedule(tests.staff('Collaborateur A1'), tests.establishment('Salon A'),
  '[{"weekday":1,"start":"09:00","end":"19:00"},{"weekday":2,"start":"09:00","end":"19:00"}]');
insert into public.staff_members (company_id, establishment_id, display_name, job)
values (tests.company('Salon A'), tests.establishment('Salon A'), 'Fiche invitation', 'stylist');
select set_config('request.jwt.claims', '', false);
select tests.create_user('racer', 'Racer');
SQL

book() { # $1 = heure locale
  "${PSQL[@]}" -c "begin; set local role authenticated; select tests.authenticate_as('alice');
    select public.book_appointment(tests.establishment('Salon A'), tests.staff('Collaborateur A1'), tests.service('Coupe'), '$1', 'Concurrence');
    select pg_sleep(0.4); commit;" >/dev/null 2>&1 && echo OK || echo KO
}

# 1) 20 demandes simultanées pour le même créneau → exactement 1 succès.
tmp=$(mktemp -d)
for i in $(seq 1 20); do book '2026-12-07 10:00' > "$tmp/$i" & done; wait
wins=$(cat "$tmp"/* | grep -c OK || true)
ok "$([[ $wins -eq 1 ]] && echo true)" "20 réservations simultanées du même créneau → 1 seule acceptée ($wins)"

# 2) 12 demandes simultanées décalées de 5 min (prestation de 30 min) → aucun chevauchement.
rm -f "$tmp"/*
for m in 00 05 10 15 20 25 30 35 40 45 50 55; do book "2026-12-08 14:$m" > "$tmp/$m" & done; wait
wins=$(cat "$tmp"/* | grep -c OK || true)
overlaps=$("${PSQL[@]}" -c "select count(*) from public.appointments a join public.appointments b
  on a.staff_id = b.staff_id and a.id < b.id and a.status <> 'cancelled' and b.status <> 'cancelled'
  and tstzrange(a.starts_at, a.ends_at) && tstzrange(b.starts_at, b.ends_at);")
ok "$([[ $overlaps -eq 0 && $wins -ge 1 && $wins -le 2 ]] && echo true)" "12 réservations simultanées qui se chevauchent → $wins acceptée(s), 0 chevauchement en base"

# 3) Même lien d'invitation accepté 5 fois en parallèle → 1 seule adhésion.
token=$("${PSQL[@]}" -c "select set_config('request.jwt.claims', json_build_object('sub', tests.uid('alice'))::text, false);
  select token from public.create_invitation(tests.company('Salon A'), 'racer@test.example', 'staff', tests.staff('Fiche invitation'));" | tail -1)
rm -f "$tmp"/*
for i in 1 2 3 4 5; do
  ( "${PSQL[@]}" -c "begin; set local role authenticated; select tests.authenticate_as('racer');
      select public.accept_invitation('$token'); select pg_sleep(0.3); commit;" >/dev/null 2>&1 && echo OK || echo KO ) > "$tmp/$i" &
done; wait
wins=$(cat "$tmp"/* | grep -c OK || true)
members=$("${PSQL[@]}" -c "select count(*) from public.memberships where user_id = tests.uid('racer');")
ok "$([[ $wins -eq 1 && $members -eq 1 ]] && echo true)" "5 acceptations simultanées d'un même lien → 1 seule ($wins), 1 adhésion"
rm -rf "$tmp"
echo "CONCURRENCE_OK $pass"
