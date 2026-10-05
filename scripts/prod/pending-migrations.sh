#!/usr/bin/env bash
# scripts/prod/pending-migrations.sh — které migrace z migrations/ produkce ještě nemá (kolo 9 / krok 5). JEN ČTENÍ.
#
#   PROD_OWNER_URL=postgresql://… scripts/prod/pending-migrations.sh
#
# Porovná soubory migrations/[4-9][0-9][0-9]_*.sql (pořadí = pořadí aplikace, stejně jako scripts/run-migrations.sh)
# s tabulkou public.schema_migrations. Vypíše chybějící v pořadí a u každé odhad zámků (ALTER TABLE na velkých
# tabulkách = krátký ACCESS EXCLUSIVE zámek; CREATE INDEX bez CONCURRENTLY = blokuje zápisy do tabulky).
set -euo pipefail
export LC_ALL=C
: "${PROD_OWNER_URL:?chybí PROD_OWNER_URL}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
applied=$(psql "$PROD_OWNER_URL" -At -v ON_ERROR_STOP=1 -c "BEGIN READ ONLY; SELECT filename FROM public.schema_migrations; ROLLBACK;" | grep -v -E '^(BEGIN|ROLLBACK)$' || true)
pending=0
for f in "$ROOT"/migrations/[4-9][0-9][0-9]_*.sql; do
  b=$(basename "$f")
  if ! grep -qx "$b" <<<"$applied"; then
    pending=$((pending + 1))
    locks=$(grep -ciE '^\s*ALTER TABLE' "$f" || true)
    idx=$(grep -iE 'CREATE (UNIQUE )?INDEX' "$f" | grep -viEc 'CONCURRENTLY' || true)
    printf '%-45s ALTER TABLE: %-3s CREATE INDEX: %s\n' "$b" "$locks" "$idx"
  fi
done
echo "chybějících migrací: $pending"
