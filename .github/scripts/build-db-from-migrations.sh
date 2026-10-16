#!/usr/bin/env bash
# Postaví databázi Tixly OD NULY z migrací (000_baseline + globals + 4xx–9xx; kolo 8: dřív jen 4xx → 500+ by se nespustily) — pro CI service
# kontejner i lokální ověření. Žádné spojení na produkci; zdroj pravdy = soubory v migrations/.
#
# Použití:  .github/scripts/build-db-from-migrations.sh <admin_url> <dbname> [app_password]
#   admin_url    — superuživatel/owner na serveru, např. postgresql://neondb_owner:fixowner@localhost:55632/neondb
#   dbname       — databáze, která se (znovu) založí, např. e2e
#   app_password — heslo role tixly_app (výchozí: fixapp; testovací hodnota, ne produkční)
#
# Ekvivalent audit/db/migrate-from-zero.sh, ale přes psql/TCP (bez docker exec), aby šel
# pustit v GitHub Actions proti service kontejneru.
set -euo pipefail
export LC_ALL=C

ADMIN_URL="${1:?admin_url}"
DB="${2:?dbname}"
APP_PW="${3:-fixapp}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
MIG="$ROOT/migrations"

base_url="${ADMIN_URL%/*}"          # bez /databáze
db_url="$base_url/$DB"

psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -q -c "DROP DATABASE IF EXISTS \"$DB\" WITH (FORCE)" -c "CREATE DATABASE \"$DB\" TEMPLATE template0"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
# \restrict / \unrestrict jsou psql>=17.6 meta-příkazy z pg_dump 17.10 — starší psql je nezná.
grep -v -E '^\\(un)?restrict' "$MIG/000_baseline_20260730.sql" > "$tmp/000_baseline.sql"

fail=0
apply() {
  local f="$1" name="$2"
  if out=$(psql "$db_url" -v ON_ERROR_STOP=1 -q -f "$f" 2>&1); then
    echo "OK   $name"
  else
    echo "FAIL $name"; printf '%s\n' "$out" | grep -E 'ERROR|FATAL|psql:' | head -5
    fail=$((fail + 1))
  fi
}

apply "$tmp/000_baseline.sql" 000_baseline_20260730.sql
apply "$MIG/000_baseline_globals.sql" 000_baseline_globals.sql
# glob se v bash řadí podle locale; LC_ALL=C pro jistotu stejného pořadí jako `sort`
for f in "$MIG"/[4-9][0-9][0-9]_*.sql; do
  apply "$f" "$(basename "$f")"
done

# Testovací heslo aplikační role (produkce si ho nastavuje sama, viz GO-LIVE-CHECKLIST).
psql "$db_url" -v ON_ERROR_STOP=1 -q -c "ALTER ROLE tixly_app WITH LOGIN PASSWORD '$APP_PW'"

echo "FAILED_FILES=$fail"
[ "$fail" -eq 0 ]
