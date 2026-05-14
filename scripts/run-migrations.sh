#!/usr/bin/env bash
#
# Tixly migration runner
# Usage: DATABASE_URL=postgres://... ./scripts/run-migrations.sh
#
# Spustí všechny migrace v ./migrations/*.sql v abecedním pořadí.
# Idempotent: každý soubor obsahuje BEGIN/COMMIT a uses IF NOT EXISTS kde to dává smysl.
#
# Pro produkční DB (Neon / Supabase / Hetzner Postgres):
#   1. Vytvoř DB
#   2. Export DATABASE_URL=postgres://user:pass@host:5432/dbname
#   3. Spustit tento script
#   4. Ověřit: /api/health vrátí status='ok'

set -euo pipefail

if [ -z "${DATABASE_URL:-}" ]; then
  echo "❌ DATABASE_URL není nastavený"
  echo "   export DATABASE_URL=postgres://user:pass@host:5432/dbname"
  exit 1
fi

MIGRATIONS_DIR="$(dirname "$0")/../migrations"
if [ ! -d "$MIGRATIONS_DIR" ]; then
  echo "❌ Migrations directory nenalezen: $MIGRATIONS_DIR"
  exit 1
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "❌ psql nenalezen. Instaluj postgresql-client."
  exit 1
fi

echo "🔍 Připojuji k DB..."
if ! psql "$DATABASE_URL" -c "SELECT version();" >/dev/null 2>&1; then
  echo "❌ Nelze se připojit k DB."
  echo "   Zkontroluj DATABASE_URL: $DATABASE_URL"
  exit 1
fi
echo "✓ DB connected"

# Vytvoř tracking tabulku pokud chybí
psql "$DATABASE_URL" <<'SQL' >/dev/null
CREATE TABLE IF NOT EXISTS public.schema_migrations (
  filename TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
SQL

APPLIED=0
SKIPPED=0
FAILED=0

# Run all .sql files in sorted order
for file in $(ls -1 "$MIGRATIONS_DIR"/*.sql | sort); do
  basename=$(basename "$file")

  # Skip pokud už aplikováno
  already=$(psql "$DATABASE_URL" -tAc "SELECT COUNT(*) FROM public.schema_migrations WHERE filename = '$basename'")
  if [ "$already" -ge "1" ]; then
    echo "⏭  $basename (už aplikováno)"
    SKIPPED=$((SKIPPED + 1))
    continue
  fi

  echo "▶  $basename"
  if psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$file" >/tmp/migration-out.log 2>&1; then
    psql "$DATABASE_URL" -c "INSERT INTO public.schema_migrations (filename) VALUES ('$basename')" >/dev/null
    APPLIED=$((APPLIED + 1))
    echo "✓  $basename"
  else
    FAILED=$((FAILED + 1))
    echo "❌ $basename"
    tail -20 /tmp/migration-out.log
    echo ""
    echo "Migration selhala. Oprav SQL a spusť znovu (idempotent)."
    exit 1
  fi
done

echo ""
echo "═══════════════════════════════════════"
echo " Aplikováno:  $APPLIED"
echo " Přeskočeno:  $SKIPPED (už bylo)"
echo " Selhalo:     $FAILED"
echo "═══════════════════════════════════════"

if [ "$APPLIED" -gt "0" ]; then
  echo ""
  echo "✓ Hotovo. Ověř /api/health endpoint:"
  echo "  curl https://<your-domain>/api/health | jq"
fi
