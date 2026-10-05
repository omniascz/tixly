#!/usr/bin/env bash
# scripts/staging/create.sh — založí TESTOVACÍ prostředí (staging) Tixly (kolo 9 / krok 4).
#
# Režimy:
#   Neon (výchozí):  NEON_API_KEY=… scripts/staging/create.sh
#       → vytvoří SAMOSTATNÝ Neon projekt (ne větev produkční DB s reálnými daty), aplikuje migrace od nuly,
#         nastaví role (tixly_app NOBYPASSRLS + heslo), nahraje demo data agentury, ověří role a RLS,
#         zapíše proměnné pro Vercel preview do staging.env (práva 600, nevypisuje se).
#   Lokálně:  scripts/staging/create.sh --local postgresql://owner:heslo@host:port/postgres
#       → totéž proti lokálnímu Postgresu (ověření nanečisto bez Neonu).
#   --dry-run  → nic neprovede, jen vypíše plán a volání API (bez tajemství).
#
# Proměnné (volitelné): STAGING_PROJECT_NAME (tixly-staging), NEON_REGION (aws-eu-central-1), STAGING_DB (tixly),
#   STAGING_APP_DB_PASSWORD (jinak vygenerováno), STAGING_PROMOTER_EMAIL (demo@tixly-staging.test),
#   STAGING_PROMOTER_PASSWORD (jinak vygenerováno), STAGING_ENV_FILE (staging.env), PROD_DB_HOSTS (čárkou),
#   PSQL_DOCKER_ARGS — když na stroji není psql 17, spouští se v kontejneru postgres:17 s těmito argumenty
#   (např. "--network container:fix-pg").
#
# Pojistky: odmítne pokračovat, když NEON_PROJECT_ID / cílový host odpovídá produkci (vestavěný seznam = stejný jako
# src/lib/env/staging-guard.ts, + PROD_DB_HOSTS); nikdy nepoužije existující projekt ani větev.
set -euo pipefail
export LC_ALL=C

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PROD_MARKERS="ep-weathered-wind-alvbjysw fragrant-wildflower-75132205 $(printf %s "${PROD_DB_HOSTS:-}" | tr , " ")"
MODE=neon
DRY=0
LOCAL_ADMIN_URL=""
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY=1 ;;
    --local) MODE=local; LOCAL_ADMIN_URL="${2:?--local vyžaduje admin URL}"; shift ;;
    -h|--help) sed -n '2,22p' "$0"; exit 0 ;;
    *) echo "neznámý argument: $1" >&2; exit 2 ;;
  esac
  shift
done

PROJECT_NAME="${STAGING_PROJECT_NAME:-tixly-staging}"
REGION="${NEON_REGION:-aws-eu-central-1}"
DB="${STAGING_DB:-tixly}"
PROMOTER_EMAIL="${STAGING_PROMOTER_EMAIL:-demo@tixly-staging.test}"
ENV_FILE="${STAGING_ENV_FILE:-$ROOT/staging.env}"

log() { printf '[staging] %s\n' "$*"; }
die() { printf '[staging] CHYBA: %s\n' "$*" >&2; exit 1; }
rand() { node -e "process.stdout.write(require('crypto').randomBytes(${1:-24}).toString('base64url'))"; }
refuse_if_prod() {
  local what="$1" m
  for m in $PROD_MARKERS; do
    [ -n "$m" ] || continue
    case "$what" in *"$m"*) die "cíl odpovídá produkci ($m) — staging se proti produkci nezakládá" ;; esac
  done
}

# psql / bash s psql: lokální psql 17, jinak kontejner postgres:17 (repo připojené jako /repo)
REPO_IN="$ROOT"
run_pg() {
  if command -v psql >/dev/null 2>&1 && psql --version | grep -q ' 1[7-9]\.'; then
    bash -c "$1"
  else
    # shellcheck disable=SC2086
    MSYS_NO_PATHCONV=1 docker run --rm -i ${PSQL_DOCKER_ARGS:-} -v "$ROOT:/repo" postgres:17 bash -c "$1"
  fi
}
if ! command -v psql >/dev/null 2>&1; then REPO_IN=/repo; fi

APP_PW="${STAGING_APP_DB_PASSWORD:-}"
PROMOTER_PW="${STAGING_PROMOTER_PASSWORD:-}"

# ── 1) databázový server ─────────────────────────────────────────────────────
if [ "$MODE" = neon ]; then
  [ -n "${NEON_API_KEY:-}" ] || die "chybí NEON_API_KEY (účet/organizace s právem zakládat projekty — klíč omezený na produkční projekt nestačí)"
  refuse_if_prod "${NEON_PROJECT_ID:-}"
  body=$(printf '{"project":{"name":"%s","region_id":"%s","pg_version":17}}' "$PROJECT_NAME" "$REGION")
  if [ "$DRY" = 1 ]; then
    log "DRY-RUN: POST https://console.neon.tech/api/v2/projects  $body  (Authorization: Bearer ***)"
    ADMIN_URL="postgresql://neondb_owner:***@ep-NEW.$REGION.aws.neon.tech/neondb?sslmode=require"
  else
    log "zakládám Neon projekt $PROJECT_NAME ($REGION)"
    resp=$(curl -fsS -X POST https://console.neon.tech/api/v2/projects \
      -H "Authorization: Bearer $NEON_API_KEY" -H 'Content-Type: application/json' -d "$body")
    ADMIN_URL=$(printf '%s' "$resp" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);process.stdout.write(j.connection_uris[0].connection_uri)})")
    PROJECT_ID=$(printf '%s' "$resp" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>process.stdout.write(JSON.parse(s).project.id))")
    log "projekt $PROJECT_ID vytvořen"
  fi
else
  ADMIN_URL="$LOCAL_ADMIN_URL"
  # Role (tixly_app) jsou v Postgresu společné pro celý server — vygenerované heslo by přepsalo heslo všem
  # databázím na sdíleném lokálním serveru. Lokálně proto heslo musí zadat volající (např. testovací „fixapp").
  [ -n "$APP_PW" ] || die "--local vyžaduje STAGING_APP_DB_PASSWORD (role tixly_app je společná pro celý server)"
fi
refuse_if_prod "$ADMIN_URL"

[ -n "$APP_PW" ] || APP_PW=$(rand 24)
[ -n "$PROMOTER_PW" ] || PROMOTER_PW=$(rand 12)
base_url="${ADMIN_URL%/*}"
q_suffix=""
case "$ADMIN_URL" in *\?*) q_suffix="?${ADMIN_URL#*\?}"; base_url="${ADMIN_URL%%\?*}"; base_url="${base_url%/*}" ;; esac
OWNER_DB_URL="$base_url/$DB$q_suffix"
host_part="${base_url#*@}"
APP_DB_URL="postgresql://tixly_app:$APP_PW@$host_part/$DB$q_suffix"

if [ "$DRY" = 1 ]; then
  log "DRY-RUN: migrace od nuly → $base_url/$DB (scripts .github/scripts/build-db-from-migrations.sh)"
  log "DRY-RUN: role tixly_app NOBYPASSRLS + heslo; demo data scripts/staging/seed-demo.sql (pořadatel $PROMOTER_EMAIL)"
  log "DRY-RUN: ověření rolí a RLS; zápis $ENV_FILE"
  exit 0
fi

# ── 2) migrace od nuly + role ────────────────────────────────────────────────
log "migrace od nuly do databáze $DB"
run_pg "bash '$REPO_IN/.github/scripts/build-db-from-migrations.sh' '$ADMIN_URL' '$DB' '$APP_PW'" | tail -3

# ── 3) demo data ─────────────────────────────────────────────────────────────
HASH=$(cd "$ROOT/nextjs-boilerplate" && node -e "process.stdout.write(require('bcryptjs').hashSync(process.argv[1], 12))" "$PROMOTER_PW")
log "nahrávám demo data agentury"
run_pg "psql '$OWNER_DB_URL' -v ON_ERROR_STOP=1 -q -v promoter_email='$PROMOTER_EMAIL' -v promoter_hash='$HASH' -f '$REPO_IN/scripts/staging/seed-demo.sql'"

# ── 4) ověření rolí a RLS ────────────────────────────────────────────────────
log "ověřuji role a RLS"
run_pg "psql '$OWNER_DB_URL' -v ON_ERROR_STOP=1 -At -c \"SELECT 'tixly_app '||CASE WHEN rolbypassrls THEN 'BYPASSRLS(!)' ELSE 'NOBYPASSRLS' END||CASE WHEN rolsuper THEN ' SUPERUSER(!)' ELSE '' END FROM pg_roles WHERE rolname='tixly_app'\" -c \"SELECT 'policies='||count(*) FROM pg_policies\""
run_pg "psql '$APP_DB_URL' -v ON_ERROR_STOP=1 -At -c \"SELECT 'tixly_app vidí publikovaných termínů: '||count(*) FROM catalog.events WHERE status='published'\""

# ── 5) proměnné pro Vercel preview ───────────────────────────────────────────
umask 077
{
  echo "# Tixly STAGING — vygenerováno $(date -u +%FT%TZ) skriptem scripts/staging/create.sh. NIKDY do produkce."
  echo "TIXLY_ENV=staging"
  echo "DATABASE_URL=$APP_DB_URL"
  echo "DATABASE_URL_DIRECT=$APP_DB_URL"
  echo "DATABASE_URL_SUPER=$OWNER_DB_URL"
  echo "DATABASE_URL_OPS=$OWNER_DB_URL"
  echo "STAGING_PROMOTER_EMAIL=$PROMOTER_EMAIL"
  echo "STAGING_PROMOTER_PASSWORD=$PROMOTER_PW"
  echo "# Doplnit podle scripts/staging/vercel-preview.env.example (sandbox brány, testovací e-mail, tajné klíče)."
} > "$ENV_FILE"
log "hotovo — proměnné zapsané do $ENV_FILE (práva 600); demo pořadatel $PROMOTER_EMAIL"
