#!/usr/bin/env bash
# Kolo 23 — databáze OD NULY z migrací v lokálním fix-pg (.github/scripts/build-db-from-migrations.sh). Použití: build_db.sh <db>
T=/c/Users/omnia/Documents/tixly
MSYS_NO_PATHCONV=1 docker run --rm --network container:fix-pg -v "$T:/repo" -w /repo postgres:17 \
  bash .github/scripts/build-db-from-migrations.sh postgresql://neondb_owner:fixowner@localhost:5432/postgres "${1:?db}" fixapp
