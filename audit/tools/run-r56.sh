#!/bin/sh
# AUDIT R-56 runner: DB r56 (kopie tixly_audit = schema z migraci), PgBouncer (transaction mode),
# pak audit/tests/r56-pool-context.test.ts ve 3 konfiguracich. Vysledky: audit/logs/12_r56_*.log
export MSYS_NO_PATHCONV=1
cd "$(dirname "$0")/../.." || exit 1
PW=auditapp
docker exec audit-pg psql -U neondb_owner -d neondb -qc "DROP DATABASE IF EXISTS r56" -c "CREATE DATABASE r56 TEMPLATE tixly_audit" -c "ALTER ROLE tixly_app WITH PASSWORD '$PW'"
printf '"tixly_app" "%s"\n"neondb_owner" "auditowner"\n' "$PW" > audit/db/userlist.txt
docker rm -f audit-pgb >/dev/null 2>&1
docker run -d --name audit-pgb --network audit-net -p 56432:6432 \
  -v "$(pwd -W)/audit/db/pgbouncer.ini:/etc/pgbouncer/pgbouncer.ini:ro" \
  -v "$(pwd -W)/audit/db/userlist.txt:/etc/pgbouncer/userlist.txt:ro" \
  --entrypoint pgbouncer edoburu/pgbouncer:latest /etc/pgbouncer/pgbouncer.ini >/dev/null
sleep 3
POOLER="postgresql://tixly_app:$PW@localhost:56432/r56"
DIRECT="postgresql://tixly_app:$PW@localhost:55432/r56"
OWNERURL="postgresql://neondb_owner:auditowner@localhost:55432/r56"
cd nextjs-boilerplate || exit 1
for MODE in direct fixed nodirect; do
  case $MODE in
    direct)   export DATABASE_URL=$DIRECT; unset DATABASE_URL_DIRECT;;
    fixed)    export DATABASE_URL=$POOLER; export DATABASE_URL_DIRECT=$DIRECT;;
    nodirect) export DATABASE_URL=$POOLER; unset DATABASE_URL_DIRECT;;
  esac
  R56_MODE=$MODE AUDIT_OWNER_URL=$OWNERURL ENCRYPTION_KEY=$(printf 'a%.0s' $(seq 1 64)) \
    npx vitest run --config ../audit/tests/vitest.audit.config.ts tests/r56-pool-context.test.ts \
    > ../audit/logs/12_r56_$MODE.log 2>&1
  echo "== $MODE exit=$?"; grep -o '\[R56-RESULT\].*' ../audit/logs/12_r56_$MODE.log
done
