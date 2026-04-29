#!/bin/bash
# Inicializace Tixly DB schématu a migrací.
# Spouští se automaticky při prvním startu kontejneru (docker-entrypoint-initdb.d).
#
# Pozn.: ticketing_schema.sql obsahuje stejný baseline jako migrations/001_initial.sql,
# proto migraci 001 přeskočíme (jinak: "relation already exists").

set -e

echo "==> Aplikuji ticketing_schema.sql..."
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -f /docker/ticketing_schema.sql

echo "==> Aplikuji migrace (002+)..."
for migration in /docker/migrations/*.sql; do
  if [ -f "$migration" ]; then
    name=$(basename "$migration")
    case "$name" in
      001_initial.sql)
        echo "    → SKIP $name (pokrývá ticketing_schema.sql)"
        continue
        ;;
    esac
    echo "    → $name"
    psql -v ON_ERROR_STOP=0 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
      -f "$migration" || echo "      [WARN] migrace $name selhala — pokračuji"
  fi
done

echo "==> DB inicializace dokončena."
