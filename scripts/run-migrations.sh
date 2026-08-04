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

# ⚠️ Evidenci NEVYTVÁŘÍME dopředu. `000_baseline` obsahuje vlastní
# `CREATE TABLE public.schema_migrations` (je součástí dumpu schématu), takže
# předvytvořená tabulka mu na PRÁZDNÉ DB shodí celou migraci:
#   ERROR: relation "schema_migrations" already exists
# Dokud tabulka neexistuje, chováme se, jako by nebylo aplikováno nic; založí
# ji baseline sám a evidenci pak doplníme až po prvním úspěšném souboru.
ledger_exists() {
  [ "$(psql "$DATABASE_URL" -tAc "SELECT to_regclass('public.schema_migrations') IS NOT NULL")" = "t" ]
}
ensure_ledger() {
  psql "$DATABASE_URL" -c "CREATE TABLE IF NOT EXISTS public.schema_migrations (filename TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())" >/dev/null
}

APPLIED=0
SKIPPED=0
FAILED=0
WARNED=0

# Run all .sql files in sorted order
for file in $(ls -1 "$MIGRATIONS_DIR"/*.sql | sort); do
  basename=$(basename "$file")

  # Skip pokud už aplikováno
  if ledger_exists; then
    already=$(psql "$DATABASE_URL" -tAc "SELECT COUNT(*) FROM public.schema_migrations WHERE filename = '$basename'")
  else
    already=0
  fi
  if [ "$already" -ge "1" ]; then
    echo "⏭  $basename (už aplikováno)"
    SKIPPED=$((SKIPPED + 1))
    continue
  fi

  echo "▶  $basename"
  if psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$file" >/tmp/migration-out.log 2>&1; then
    # ON_ERROR_STOP warningy NECHYTA. GRANT na objekt vlastneny extensionou
    # vrati "WARNING: no privileges were granted" a psql skonci s kodem 0 —
    # migrace tedy "projde", aniz by nastal efekt (FINDINGS 27, 29).
    # Warningy proto vypisujeme vzdy, ne jen pri selhani.
    if grep -qiE '^WARNING' /tmp/migration-out.log; then
      W=$(grep -ciE '^WARNING' /tmp/migration-out.log || true)
      WARNED=$((WARNED + W))
      echo "!! $basename — $W warningu (exit 0, ale efekt NEMUSEL nastat):"
      grep -iE '^WARNING' /tmp/migration-out.log | head -10 | sed 's/^/      /'
    fi
    ensure_ledger
    psql "$DATABASE_URL" -c "INSERT INTO public.schema_migrations (filename) VALUES ('$basename') ON CONFLICT DO NOTHING" >/dev/null
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
echo " Warningu:    $WARNED"
echo "═══════════════════════════════════════"

if [ "$APPLIED" -gt "0" ]; then
  echo ""
  echo "✓ Hotovo. Ověř /api/health endpoint:"
  echo "  curl https://<your-domain>/api/health | jq"
fi

# Exit kod psql NENI dukaz, ze efekt nastal. Overeni je porovnani schematu —
# to dela rls-verify (RLS vrstva) a schema-reality-scan (schema a granty).
if [ "$WARNED" -gt "0" ]; then
  echo ""
  echo "!! Probehly warningy. Exit kod 0 NEZNAMENA, ze efekt nastal."
  echo "   Over stav: node nextjs-boilerplate/scripts/rls-verify.mjs"
fi
