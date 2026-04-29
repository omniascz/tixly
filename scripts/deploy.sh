#!/bin/bash
# =============================================================================
# Tixly — deployment helper
# Použití:
#   ./scripts/deploy.sh staging    ← deploy na staging
#   ./scripts/deploy.sh production ← deploy na produkci (vyžaduje potvrzení)
# =============================================================================

set -euo pipefail

ENV=${1:-staging}
NEXTJS_DIR="nextjs-boilerplate"

# Barvy
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()  { echo -e "${GREEN}[deploy]${NC} $1"; }
warn() { echo -e "${YELLOW}[warn]${NC} $1"; }
die()  { echo -e "${RED}[error]${NC} $1"; exit 1; }

# Ověř prostředí
[[ "$ENV" == "staging" || "$ENV" == "production" ]] || \
  die "Neznámé prostředí: '$ENV'. Použij 'staging' nebo 'production'."

# Produkce vyžaduje explicitní potvrzení
if [[ "$ENV" == "production" ]]; then
  warn "Deployuješ na PRODUKCI. Opravdu? (napiš 'ano')"
  read -r confirm
  [[ "$confirm" == "ano" ]] || die "Deploy zrušen."
fi

log "Prostředí: $ENV"
log "Branch: $(git branch --show-current)"
log "Commit: $(git rev-parse --short HEAD)"

# Kontrola čistého working tree
if [[ -n "$(git status --porcelain)" ]]; then
  die "Working tree není čistý. Commitni nebo stashni změny před deployem."
fi

# 1. Testy
log "Spouštím testy..."
cd "$NEXTJS_DIR"
npm ci --silent
npm test -- --run
cd ..

# 2. Build check
log "Kontroluji build..."
cd "$NEXTJS_DIR"
npm run type-check
npm run lint
cd ..

# 3. Vercel deploy
log "Deployuji na Vercel ($ENV)..."
cd "$NEXTJS_DIR"

if [[ "$ENV" == "production" ]]; then
  vercel deploy --prod --token="$VERCEL_TOKEN"
else
  vercel deploy --token="$VERCEL_TOKEN"
fi

log "Deploy dokončen!"

# 4. DB migrace (jen produkce)
if [[ "$ENV" == "production" ]]; then
  log "Spouštím DB migrace..."
  for migration in ../migrations/*.sql; do
    if [[ -f "$migration" ]]; then
      log "  → $migration"
      psql "$DATABASE_URL" -f "$migration"
    fi
  done
  log "Migrace dokončeny."
fi

log "Hotovo ✓"
