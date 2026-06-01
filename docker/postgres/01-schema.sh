#!/bin/bash
# Inicializace Tixly DB ze SQUASH-BASELINE (2026-06-01).
# Spouští se automaticky při prvním startu kontejneru (docker-entrypoint-initdb.d).
#
# ZMĚNA 2026-06-01: dřívější postup (ticketing_schema.sql + replay migrations/*.sql)
# na čisté DB selhával u 47 migrací (drift + přečíslování) a init je jen WARNoval
# (ON_ERROR_STOP=0) → tichá díra. Nově aplikujeme jeden ověřený baseline (pg_dump
# funkční dev DB) s ON_ERROR_STOP=1, takže jakákoli chyba init HLASITĚ zastaví.
#
# Baseline = kompletní schema k 2026-06-01 (migrace 001-326 jsou v něm zahrnuté).
# Budoucí migrace (NAD baseline) se aplikují přes scripts/run-migrations.sh.

set -e

echo "==> Role preamble (db/000_roles.sql)..."
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -f /docker/db/000_roles.sql

echo "==> Baseline schema (db/baseline.sql)..."
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -f /docker/db/baseline.sql

echo "==> DB inicializace ze baseline dokončena."
