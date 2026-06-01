#!/usr/bin/env bash
#
# Tixly — provisioning čisté databáze ze squash-baseline (2026-06-01)
#
# NAHRAZUJE starý postup `ticketing_schema.sql + migrations/*.sql`, který na
# čisté DB selhával u 47 migrací (drift + přečíslování; auto-init je jen WARNoval
# a pokračoval). Squash-baseline = pg_dump funkční dev DB → garantovaně čistý,
# dependency-ordered schema, který sedne na prázdnou DB bez chyby.
#
# Použití:
#   DATABASE_URL=postgres://user:pass@host:5432/dbname ./scripts/provision-clean-db.sh
#   DATABASE_URL=...  SEED=1  ./scripts/provision-clean-db.sh    # + demo seed
#
# Lokálně (přes docker kontejner, kde běží psql):
#   docker exec -i tixly-postgres psql -U tixly -d <db> < db/000_roles.sql
#   docker exec -i tixly-postgres psql -U tixly -d <db> < db/baseline.sql
#
set -euo pipefail

if [ -z "${DATABASE_URL:-}" ]; then
  echo "❌ DATABASE_URL není nastavený"; exit 1
fi
if ! command -v psql >/dev/null 2>&1; then
  echo "❌ psql nenalezen. Instaluj postgresql-client (nebo použij docker exec variantu výše)."; exit 1
fi

ROOT="$(dirname "$0")/.."

echo "🔍 Připojuji k DB..."
psql "$DATABASE_URL" -c "SELECT version();" >/dev/null
echo "✓ DB connected"

echo "▶  db/000_roles.sql (role + tracking)"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$ROOT/db/000_roles.sql" >/dev/null
echo "✓  role připraveny"

echo "▶  db/baseline.sql (kompletní schema — ~490 tabulek, 91 funkcí, 160 RLS policies)"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$ROOT/db/baseline.sql" >/dev/null
echo "✓  schema aplikováno"

if [ "${SEED:-0}" = "1" ]; then
  echo "▶  demo seed (platform + rich-demo phase1-5)"
  # POZN.: phase2 čte /tmp/layouts/*.json (scripts/layouts mount). seed-strelnice-chart
  # je self-contained golden-path chart, musí běžet před phase3-seats.
  for s in seed-platform \
           seed-rich-demo-phase1 seed-rich-demo-phase2 seed-strelnice-chart \
           seed-rich-demo-phase3-events seed-rich-demo-phase3-seats \
           seed-rich-demo-phase4-orders seed-rich-demo-phase5-final; do
    echo "   → $s"
    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$ROOT/scripts/$s.sql" >/dev/null
  done
  echo "✓  seed hotový"
fi

echo ""
echo "═══════════════════════════════════════"
echo " ✓ Čistá DB připravená."
echo "   Golden-path event: Romeo a Julie (308 sedadel) je-li SEED=1."
echo "═══════════════════════════════════════"
