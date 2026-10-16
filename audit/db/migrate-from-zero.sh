#!/bin/sh
# Audit: aplikace migraci OD NULY do prazdne DB (CREATE DATABASE ... TEMPLATE template0)
# v izolovanem kontejneru audit-pg (NIKDY ne produkce).
# Pouziti (z korene worktree): sh audit/db/migrate-from-zero.sh <dbname> [migrations_dir]
export MSYS_NO_PATHCONV=1
set -u
DB=${1:-tixly_audit}
SRC=${2:-migrations}
TMP=audit/db/_mig_tmp; rm -rf "$TMP"; mkdir -p "$TMP"
cp "$SRC"/*.sql "$TMP"/
# \restrict / \unrestrict jsou psql>=17.6 meta-prikazy (pg_dump 17.10). Kontejner ma psql 17.5,
# ktery je nezna -> filtr, identicky se stripPsqlMeta() v nextjs-boilerplate/scripts/baseline-clone.mjs
grep -v -E '^\\(un)?restrict' "$SRC/000_baseline_20260730.sql" > "$TMP/000_baseline_20260730.sql"
docker exec ${PGC:-audit-pg} psql -U neondb_owner -d neondb -v ON_ERROR_STOP=1 -qc "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB TEMPLATE template0"
docker exec ${PGC:-audit-pg} rm -rf /mig && docker cp "$TMP" ${PGC:-audit-pg}:/mig
rm -rf "$TMP"
FAIL=0
for f in 000_baseline_20260730.sql 000_baseline_globals.sql $(ls "$SRC" | grep -E '^4[0-9]{2}_.*\.sql$' | sort); do
  OUT=$(docker exec ${PGC:-audit-pg} psql -U neondb_owner -d "$DB" -v ON_ERROR_STOP=1 -q -f "/mig/$f" 2>&1)
  RC=$?
  WARN=$(printf '%s\n' "$OUT" | grep -c 'WARNING')
  if [ $RC -ne 0 ]; then FAIL=$((FAIL+1)); echo "FAIL $f rc=$RC"; printf '%s\n' "$OUT" | grep -E 'ERROR|FATAL|psql:' | head -5
  else echo "OK   $f (warnings=$WARN)"; [ "$WARN" -gt 0 ] && printf '%s\n' "$OUT" | grep WARNING | sort | uniq -c | head -5; fi
done
echo "FAILED_FILES=$FAIL"
