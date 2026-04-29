#!/bin/bash
# Inicializace Tixly DB schématu a migrací.
# Spouští se automaticky při prvním startu kontejneru (docker-entrypoint-initdb.d).

set -e

echo "==> Aplikuji ticketing_schema.sql..."
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -f /docker/ticketing_schema.sql

echo "==> Aplikuji migrace..."
for migration in /docker/migrations/*.sql; do
  if [ -f "$migration" ]; then
    echo "    → $migration"
    psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
      -f "$migration"
  fi
done

echo "==> DB inicializace dokončena."
