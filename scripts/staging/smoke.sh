#!/usr/bin/env bash
# scripts/staging/smoke.sh — smoke test BĚŽÍCÍHO stagingu (kolo 9 / krok 4).
#
#   STAGING_URL=https://tixly-staging.vercel.app STAGING_DB_OWNER_URL=postgresql://… MAILPIT=https://… \
#   CRON_SECRET=… scripts/staging/smoke.sh [--dry-run] [--skip-tour] [--skip-sandbox]
#
# Kroky:
#   1) pojistky: STAGING_URL ani DB nesmí být produkce (stejný seznam jako staging-guard)
#   2) zdraví: hlavní stránka, program, přihlášení, API health
#   3) scénář turné (Playwright, e2e/tests/golden-path-r8-theatre-tour.spec.ts) proti stagingu;
#      platby přes sandbox GoPay: TOUR_PAY_MODE=manual — okno prohlížeče se otevře a platbu testovací kartou
#      provede člověk (sandbox GoPay nelze bezpečně automatizovat bez znalosti jeho stránky); e-maily čte z MAILPIT
#      (API kompatibilní s Mailpit — staging musí posílat e-maily do takové schránky)
#   4) sandbox testy GoPay a ComGate (nextjs-boilerplate/tests/sandbox, npm run test:sandbox) s klíči sandboxu
#      GOPAY_* / COMGATE_* v prostředí
#   --dry-run vypíše plán a příkazy, nic nespouští.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DRY=0; SKIP_TOUR=0; SKIP_SANDBOX=0
for a in "$@"; do
  case "$a" in
    --dry-run) DRY=1 ;; --skip-tour) SKIP_TOUR=1 ;; --skip-sandbox) SKIP_SANDBOX=1 ;;
    -h|--help) sed -n '2,17p' "$0"; exit 0 ;;
    *) echo "neznámý argument: $a" >&2; exit 2 ;;
  esac
done
log() { printf '[smoke] %s\n' "$*"; }
die() { printf '[smoke] CHYBA: %s\n' "$*" >&2; exit 1; }
run() { if [ "$DRY" = 1 ]; then printf '[smoke] DRY-RUN: %s\n' "$*"; else "$@"; fi; }

: "${STAGING_URL:?chybí STAGING_URL}"
# produkční doména = přesná shoda hostitele (staging.tixly.cz je v pořádku); produkční DB = výskyt markeru v URL
STAGING_HOST=$(printf %s "$STAGING_URL" | sed -E 's#^[a-z]+://##; s#[/:?].*$##' | tr '[:upper:]' '[:lower:]')
for h in app.tixly.cz tixly.cz www.tixly.cz $(printf %s "${PROD_APP_HOSTS:-}" | tr , " "); do
  [ "$STAGING_HOST" != "$h" ] || die "cíl odpovídá produkci ($h)"
done
for m in ep-weathered-wind-alvbjysw fragrant-wildflower-75132205 $(printf %s "${PROD_DB_HOSTS:-}" | tr , " "); do
  case "${STAGING_DB_OWNER_URL:-}" in *"$m"*) die "databáze odpovídá produkci ($m)";; esac
done

log "1) zdraví stagingu $STAGING_URL"
STAGING_URL="${STAGING_URL%/}"
for p in /cs /cs/program /cs/login /api/health; do
  if [ "$DRY" = 1 ]; then log "DRY-RUN: GET $STAGING_URL$p → 200"; continue; fi
  code=$(curl -s -o /dev/null -w '%{http_code}' "$STAGING_URL$p")
  [ "$code" = 200 ] || die "GET $p → $code"
  log "GET $p → 200"
done

if [ "$SKIP_TOUR" = 0 ]; then
  : "${STAGING_DB_OWNER_URL:?scénář turné potřebuje STAGING_DB_OWNER_URL (owner staging DB)}"
  : "${MAILPIT:?scénář turné potřebuje MAILPIT (API testovací schránky)}"
  : "${CRON_SECRET:?scénář turné potřebuje CRON_SECRET stagingu}"
  log "2) scénář turné (Playwright, platby ručně v sandboxu GoPay)"
  (cd "$ROOT/e2e" && run env BASE_URL="$STAGING_URL" AUDIT_OWNER_URL="$STAGING_DB_OWNER_URL" MAILPIT="$MAILPIT" CRON_SECRET="$CRON_SECRET" \
    TOUR_PAY_MODE=manual npx playwright test tests/golden-path-r8-theatre-tour.spec.ts --project golden-path --headed --reporter=list)
fi

if [ "$SKIP_SANDBOX" = 0 ]; then
  log "3) sandbox testy GoPay a ComGate"
  (cd "$ROOT/nextjs-boilerplate" && run npm run test:sandbox)
fi
log "hotovo"
