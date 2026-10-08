#!/usr/bin/env bash
# Kolo 17: zátěžový test JEDNÉ verze aplikace na runneru GitHub Actions (volá .github/workflows/loadtest.yml).
#   bash loadtest-version.sh <adresář checkoutu aplikace> <štítek> <počet běhů> <výstupní adresář>
# Stejně jako lokálně v kole 14: DB od nuly z migrací TÉTO verze + demo data (scripts/staging/create.sh --local),
# produkční build (next build + next start) přes PgBouncer (pool 10), pak zahřívací běh (5 kupců, nezapočítává se)
# a <počet běhů> × (nový termín se sálem 500 míst → k6 300 kupců / 60 s → kontrola konzistence).
# Nástroje testu (e2e/load, simulátor GoPay) jsou z větve workflow ($TOOL) — pro obě verze stejné.
# Env: TOOL, K6, APP_ENV (soubor s testovacími proměnnými, žádné produkční), REDIS_CID.
set -uo pipefail
APP="$(cd "$1" && pwd)"; LABEL="$2"; RUNS="$3"; OUT="$4"
mkdir -p "$OUT"
DB="lt_${LABEL}"
OWNER_ADMIN=postgresql://neondb_owner:fixowner@localhost:55632/neondb
OWNER_URL=postgresql://neondb_owner:fixowner@localhost:55632/$DB
log() { printf '[loadtest %s] %s\n' "$LABEL" "$*"; }

SHA=$(git -C "$APP" rev-parse HEAD)
log "verze $SHA"

# ── 1) závislosti a DB z migrací této verze + demo data agentury ─────────────────────────
(cd "$APP/nextjs-boilerplate" && npm ci --no-audit --no-fund > "$OUT/npm_ci_$LABEL.txt" 2>&1) || { log "npm ci selhal"; tail -40 "$OUT/npm_ci_$LABEL.txt"; exit 1; }
psql "$OWNER_ADMIN" -q -c "DROP DATABASE IF EXISTS $DB WITH (FORCE)"
STAGING_DB=$DB STAGING_APP_DB_PASSWORD=fixapp STAGING_PROMOTER_PASSWORD='Demo2026!heslo' STAGING_ENV_FILE="$RUNNER_TEMP/staging_$LABEL.env" \
  bash "$APP/scripts/staging/create.sh" --local "$OWNER_ADMIN" > "$OUT/db_$LABEL.txt" 2>&1 || { log "DB selhala"; tail -40 "$OUT/db_$LABEL.txt"; exit 1; }
tail -4 "$OUT/db_$LABEL.txt"

# ── 2) prostředí serveru (jako logs/r14/serve_load.sh) ──────────────────────────────────
set -a
# shellcheck disable=SC1090
. "$APP_ENV"
set +a
export DATABASE_URL=postgresql://tixly_app:fixapp@localhost:56633/$DB   # přes PgBouncer (pool 10)
export DATABASE_URL_DIRECT=$DATABASE_URL
export DATABASE_URL_SUPER=$OWNER_URL
export DATABASE_URL_OPS=$OWNER_URL

# ── 3) produkční build ──────────────────────────────────────────────────────────────────
T0=$(date +%s)
(cd "$APP/nextjs-boilerplate" && npm run build > "$OUT/build_$LABEL.txt" 2>&1) || { log "build selhal"; tail -60 "$OUT/build_$LABEL.txt"; exit 1; }
log "build $(( $(date +%s) - T0 )) s"
NEXT_VER=$(node -p "require('$APP/nextjs-boilerplate/node_modules/next/package.json').version")

# ── 4) next start ───────────────────────────────────────────────────────────────────────
(cd "$APP/nextjs-boilerplate" && exec npx next start -p 3200 > "$OUT/server_$LABEL.txt" 2>&1) &
SRV=$!
trap 'kill $SRV 2>/dev/null; pkill -f "next-server" 2>/dev/null; true' EXIT
for _ in $(seq 1 180); do curl -fs -o /dev/null http://localhost:3200/api/health && break; sleep 1; done
curl -fs -o /dev/null http://localhost:3200/api/health || { log "server nenaběhl"; tail -60 "$OUT/server_$LABEL.txt"; exit 1; }
log "server běží (next $NEXT_VER)"

flush_rl() { docker exec "$REDIS_CID" sh -c "redis-cli --scan --pattern 'rl:*' | xargs -r redis-cli del > /dev/null"; }

# jeden běh: nový termín → k6 → konzistence
one_run() {
  local name="$1"; shift
  flush_rl
  (cd "$TOOL/e2e" && BASE_URL=http://localhost:3200 OWNER_URL=$OWNER_URL node load/r14-setup.mjs > "$OUT/setup_$name.json") || { log "setup $name selhal"; return 1; }
  (cd "$TOOL/e2e" && "$K6" run --quiet -e BASE=http://localhost:3200 -e GW=http://localhost:3998 -e SETUP="$OUT/setup_$name.json" "$@" \
     --summary-export "$OUT/summary_$name.json" --out "json=$OUT/points_$name.json" load/r14-sale.k6.js > "$OUT/k6_$name.txt" 2>&1)
  log "$name: k6 exit $?"
  local ev; ev=$(node -p "require('$OUT/setup_$name.json').eventId")
  (cd "$TOOL/e2e" && BASE_URL=http://localhost:3200 OWNER_URL=$OWNER_URL CRON_SECRET="$CRON_SECRET" node load/r14-consistency.mjs "$ev" > "$OUT/consistency_$name.json")
  log "$name: konzistence exit $?"
  # 5xx / síť / neočekávané kódy po krocích (štítek status z k6 --out json), body se dál nepotřebují
  node "$TOOL/e2e/load/r17-errors.mjs" "$OUT/points_$name.json" > "$OUT/errors_$name.json" && rm -f "$OUT/points_$name.json"
}

# ── 5) zahřívací běh (5 kupců, nezapočítává se) a měřené běhy ───────────────────────────
one_run "${LABEL}_warmup" -e VUS=5 -e SPREAD_S=5 || exit 1
for i in $(seq 1 "$RUNS"); do one_run "${LABEL}_$i" || exit 1; done

node -e "require('fs').writeFileSync('$OUT/meta_$LABEL.json', JSON.stringify({ label: '$LABEL', sha: '$SHA', next: '$NEXT_VER', node: process.version, runs: $RUNS, db: '$DB' }))"
kill $SRV 2>/dev/null; wait $SRV 2>/dev/null; pkill -f next-server 2>/dev/null
for _ in $(seq 1 30); do curl -fs -o /dev/null http://localhost:3200/api/health || break; sleep 1; done
log "hotovo"
