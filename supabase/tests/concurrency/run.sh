#!/usr/bin/env bash
# Tests de CONCURRENCE (sessions PostgreSQL réellement parallèles).
# Usage interne : appelé par scripts/test-db.sh avec l'URL de la base de test jetable.
# Les données sont validées (COMMIT) : ne jamais lancer sur une base réelle.
set -euo pipefail
URL="$1"
PSQL=(psql -X -q -tA -v ON_ERROR_STOP=1 "$URL")
pass=0
ok() { if [[ "$1" == "true" ]]; then pass=$((pass + 1)); echo "     ok c$pass - $2"; else echo "✖ ÉCHEC: $2"; exit 1; fi; }

# Répertoire de travail à chemin fixe ; un sous-répertoire neuf par scénario (aucun effacement intermédiaire).
mkdir -p /var/tmp/solussimo-concurrency
newdir() { mktemp -d -p /var/tmp/solussimo-concurrency; }

# --- Données fictives validées --------------------------------------------------------
"${PSQL[@]}" <<'SQL' >/dev/null
select tests.seed();
select set_config('request.jwt.claims', json_build_object('sub', tests.uid('alice'))::text, false);
insert into public.services (company_id, name, duration_minutes, price_cents) values (tests.company('Salon A'), 'Coupe', 30, 3200);
select public.set_staff_week_schedule(tests.staff('Collaborateur A1'), tests.establishment('Salon A'),
  '[{"weekday":1,"start":"09:00","end":"19:00"},{"weekday":2,"start":"09:00","end":"19:00"}]');
insert into public.staff_members (company_id, establishment_id, display_name, job)
values (tests.company('Salon A'), tests.establishment('Salon A'), 'Fiche invitation', 'stylist');
insert into public.clients (company_id, home_establishment_id, first_name, last_name) values
  (tests.company('Salon A'), tests.establishment('Salon A'), 'Fusion', 'Un'),
  (tests.company('Salon A'), tests.establishment('Salon A'), 'Fusion', 'Deux');
select set_config('request.jwt.claims', '', false);
select tests.create_user('racer', 'Racer');
SQL

book() { # $1 = heure locale
  "${PSQL[@]}" -c "begin; set local role authenticated; select tests.authenticate_as('alice');
    select public.book_appointment(tests.establishment('Salon A'), tests.staff('Collaborateur A1'), tests.service('Coupe'), '$1', 'Concurrence');
    select pg_sleep(0.4); commit;" >/dev/null 2>&1 && echo OK || echo KO
}

# 1) 20 demandes simultanées pour le même créneau → exactement 1 succès.
d=$(newdir)
for i in $(seq 1 20); do book '2026-12-07 10:00' > "$d/$i" & done; wait
wins=$(cat "$d"/* | grep -c OK || true)
ok "$([[ $wins -eq 1 ]] && echo true)" "20 réservations simultanées du même créneau → 1 seule acceptée ($wins)"

# 2) 12 demandes simultanées décalées de 5 min (prestation de 30 min) → aucun chevauchement.
d=$(newdir)
for m in 00 05 10 15 20 25 30 35 40 45 50 55; do book "2026-12-08 14:$m" > "$d/$m" & done; wait
wins=$(cat "$d"/* | grep -c OK || true)
overlaps=$("${PSQL[@]}" -c "select count(*) from public.appointments a join public.appointments b
  on a.staff_id = b.staff_id and a.id < b.id and a.status <> 'cancelled' and b.status <> 'cancelled'
  and tstzrange(a.starts_at, a.ends_at) && tstzrange(b.starts_at, b.ends_at);")
ok "$([[ $overlaps -eq 0 && $wins -ge 1 && $wins -le 2 ]] && echo true)" "12 réservations simultanées qui se chevauchent → $wins acceptée(s), 0 chevauchement en base"

# 3) Même lien d'invitation accepté 5 fois en parallèle → 1 seule adhésion.
token=$("${PSQL[@]}" -c "select set_config('request.jwt.claims', json_build_object('sub', tests.uid('alice'))::text, false);
  select token from public.create_invitation(tests.company('Salon A'), 'racer@test.example', 'staff', tests.staff('Fiche invitation'));" | tail -1)
d=$(newdir)
for i in 1 2 3 4 5; do
  ( "${PSQL[@]}" -c "begin; set local role authenticated; select tests.authenticate_as('racer');
      select public.accept_invitation('$token'); select pg_sleep(0.3); commit;" >/dev/null 2>&1 && echo OK || echo KO ) > "$d/$i" &
done; wait
wins=$(cat "$d"/* | grep -c OK || true)
members=$("${PSQL[@]}" -c "select count(*) from public.memberships where user_id = tests.uid('racer');")
ok "$([[ $wins -eq 1 && $members -eq 1 ]] && echo true)" "5 acceptations simultanées d'un même lien → 1 seule ($wins), 1 adhésion"

# 4) Deux fusions croisées simultanées (A←B et B←A) → une seule aboutit, aucun interblocage.
ida=$("${PSQL[@]}" -c "select id from public.clients where last_name = 'Un'")
idb=$("${PSQL[@]}" -c "select id from public.clients where last_name = 'Deux'")
d=$(newdir)
merge() { "${PSQL[@]}" -c "begin; set local role authenticated; select tests.authenticate_as('alice');
  select public.merge_clients('$1', '$2'); select pg_sleep(0.4); commit;" > "$d/err-$3" 2>&1 && echo OK || echo KO; }
merge "$ida" "$idb" 1 > "$d/r1" & merge "$idb" "$ida" 2 > "$d/r2" & wait
wins=$(cat "$d/r1" "$d/r2" | grep -c OK || true)
deadlock=$(cat "$d"/err-* | grep -c deadlock || true)
active=$("${PSQL[@]}" -c "select count(*) from public.clients where last_name in ('Un', 'Deux') and status = 'active'")
ok "$([[ $wins -eq 1 && $deadlock -eq 0 && $active -eq 1 ]] && echo true)" "2 fusions croisées simultanées → $wins seule aboutit, 0 interblocage, $active fiche active"

# 5) 10 créations simultanées avec le même e-mail → 1 seule fiche.
d=$(newdir)
for i in $(seq 1 10); do
  ( "${PSQL[@]}" -c "begin; set local role authenticated; select tests.authenticate_as('alice');
      insert into public.clients (company_id, home_establishment_id, first_name, email)
      values (tests.company('Salon A'), tests.establishment('Salon A'), 'Course $i', 'course@exemple.example');
      select pg_sleep(0.3); commit;" >/dev/null 2>&1 && echo OK || echo KO ) > "$d/$i" &
done; wait
wins=$(cat "$d"/* | grep -c OK || true)
rows=$("${PSQL[@]}" -c "select count(*) from public.clients where email = 'course@exemple.example'")
ok "$([[ $wins -eq 1 && $rows -eq 1 ]] && echo true)" "10 créations simultanées du même e-mail → 1 seule fiche ($wins)"

rm -rf /var/tmp/solussimo-concurrency
echo "CONCURRENCE_OK $pass"
