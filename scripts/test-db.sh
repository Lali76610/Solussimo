#!/usr/bin/env bash
# Exécute les tests de sécurité SQL (RLS, privilèges, RGPD).
#
#   DATABASE_URL=postgres://... ./scripts/test-db.sh
#
# Par défaut, (re)crée une base jetable « solussimo_test » sur le serveur visé,
# installe le stub Supabase si le schéma auth n'existe pas (PostgreSQL nu en
# CI), applique les migrations dans l'ordre puis lance chaque fichier de test.
# NE JAMAIS pointer vers une base de production.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ADMIN_URL="${DATABASE_URL:-postgres://postgres@localhost:5432/postgres}"
TEST_DB="${TEST_DB_NAME:-solussimo_test}"
# Remplace le nom de base dans l'URL (en conservant d'éventuels paramètres ?…).
base="${ADMIN_URL%%\?*}"; query=""; [[ "$ADMIN_URL" == *\?* ]] && query="?${ADMIN_URL#*\?}"
TEST_URL="${base%/*}/${TEST_DB}${query}"
PSQL=(psql -X -q -v ON_ERROR_STOP=1)

echo "▶ Base de test : ${TEST_DB}"
"${PSQL[@]}" "$ADMIN_URL" -c "drop database if exists ${TEST_DB} with (force)" -c "create database ${TEST_DB}"

has_auth="$("${PSQL[@]}" "$TEST_URL" -tAc "select count(*) from pg_namespace where nspname = 'auth'")"
if [[ "$has_auth" == "0" ]]; then
  echo "▶ PostgreSQL nu : installation du stub Supabase (tests uniquement)"
  "${PSQL[@]}" "$TEST_URL" -f "$ROOT/supabase/tests/support/00_supabase_stub.sql"
fi

echo "▶ Migrations"
for f in "$ROOT"/supabase/migrations/*.sql; do
  echo "  · $(basename "$f")"
  "${PSQL[@]}" "$TEST_URL" -f "$f"
done

"${PSQL[@]}" "$TEST_URL" -f "$ROOT/supabase/tests/support/01_test_helpers.sql"

echo "▶ Tests de sécurité"
total=0
for f in "$ROOT"/supabase/tests/sql/*.sql; do
  echo "  ── $(basename "$f")"
  out="$("${PSQL[@]}" "$TEST_URL" -f "$f" 2>&1)" || { echo "$out"; echo "✖ ÉCHEC dans $(basename "$f")"; exit 1; }
  echo "$out" | sed -n 's/^.*NOTICE:  \(ok .*\)$/     \1/p'
  total=$((total + $(echo "$out" | grep -c 'NOTICE:  ok ' || true)))
done
echo "✔ ${total} assertions de sécurité réussies"
