#!/usr/bin/env bash
# scripts/staging/smoke.sh — smoke test BĚŽÍCÍHO stagingu (kolo 9 / krok 4, kolo 10 / krok 4: e-maily přes Resend).
#
#   STAGING_URL=https://tixly-staging.vercel.app RESEND_API_KEY=re_… STAGING_SMOKE_EMAIL=tester@firma.cz \
#   scripts/staging/smoke.sh [--dry-run] [--tour] [--skip-sandbox]
#
# Kroky:
#   1) pojistky: STAGING_URL ani DB nesmí být produkce (stejný seznam jako staging-guard)
#   2) zdraví: hlavní stránka, program, přihlášení, API health
#   3) e-maily přes Resend (staging nemá Mailpit): založí dva účty a pro oba požádá o obnovu hesla —
#        a) STAGING_SMOKE_EMAIL s plus-značkou (tester+smoke-<čas>@firma.cz; adresa musí být v STAGING_EMAIL_ALLOWLIST)
#        b) adresa mimo allowlist (smoke-<čas>@blocked.invalid)
#      a pak v seznamu odeslaných zpráv Resend API (GET {RESEND_API_BASE_URL}/emails) ověří: (a) odešla, (b) NE.
#      RESEND_API_KEY = klíč TÉHOŽ Resend účtu, přes který staging posílá (SMTP_PASS stagingu).
#   4) --tour: scénář turné (Playwright, e2e/tests/golden-path-r8-theatre-tour.spec.ts), platby ručně v sandboxu GoPay
#      (TOUR_PAY_MODE=manual). Turné čte obsah e-mailů (PDF vstupenek) z API Mailpitu a posílá na adresy @tixly.test —
#      proto běží jen s MAILPIT (lokální / sandboxový SMTP bez allowlistu), na Resend stagingu ne.
#   5) sandbox testy GoPay a ComGate (nextjs-boilerplate/tests/sandbox, npm run test:sandbox) s klíči sandboxu
#      GOPAY_* / COMGATE_* v prostředí
#   --dry-run vypíše plán a příkazy, nic nespouští.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DRY=0; TOUR=0; SKIP_SANDBOX=0
for a in "$@"; do
  case "$a" in
    --dry-run) DRY=1 ;; --tour) TOUR=1 ;; --skip-sandbox) SKIP_SANDBOX=1 ;;
    -h|--help) sed -n '2,23p' "$0"; exit 0 ;;
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

log "2) e-maily přes Resend (allowlist)"
: "${RESEND_API_KEY:?e-mailový krok potřebuje RESEND_API_KEY (Resend účet stagingu)}"
: "${STAGING_SMOKE_EMAIL:?e-mailový krok potřebuje STAGING_SMOKE_EMAIL (adresa ze STAGING_EMAIL_ALLOWLIST)}"
RESEND_API="${RESEND_API_BASE_URL:-https://api.resend.com}"; RESEND_API="${RESEND_API%/}"
TS=$(date +%s)
ALLOWED="${STAGING_SMOKE_EMAIL%@*}+smoke-$TS@${STAGING_SMOKE_EMAIL#*@}"
BLOCKED="smoke-$TS@blocked.invalid"
reset_mail() { # $1 = e-mail: účet + žádost o obnovu hesla (e-mail odejde jen existujícímu účtu)
  local body
  body=$(printf '{"email":"%s","password":"Smoke-%s-heslo","name":"Smoke test"}' "$1" "$TS")
  run curl -s -o /dev/null -w "register $1 → %{http_code}\n" -X POST "$STAGING_URL/api/auth/register" \
    -H 'content-type: application/json' -H "origin: $STAGING_URL" -d "$body"
  run curl -s -o /dev/null -w "forgot-password $1 → %{http_code}\n" -X POST "$STAGING_URL/api/auth/forgot-password" \
    -H 'content-type: application/json' -H "origin: $STAGING_URL" -d "{\"email\":\"$1\"}"
}
reset_mail "$ALLOWED"
reset_mail "$BLOCKED"
if [ "$DRY" = 1 ]; then
  log "DRY-RUN: GET $RESEND_API/emails → v seznamu je $ALLOWED, není $BLOCKED"
else
  found=0
  for _ in $(seq 1 30); do
    list=$(curl -s -H "Authorization: Bearer $RESEND_API_KEY" "$RESEND_API/emails")
    if printf %s "$list" | grep -qiF "\"$ALLOWED\""; then found=1; break; fi
    sleep 2
  done
  [ "$found" = 1 ] || die "Resend: e-mail na $ALLOWED se v seznamu odeslaných neobjevil (60 s) — odpověď: $(printf %s "$list" | head -c 300)"
  log "Resend: e-mail na povolenou adresu odeslán ✓"
  if printf %s "$list" | grep -qiF "\"$BLOCKED\""; then die "Resend: e-mail na $BLOCKED (mimo allowlist) ODEŠEL — allowlist nefunguje"; fi
  log "Resend: e-mail na adresu mimo allowlist neodešel ✓"
fi

if [ "$TOUR" = 1 ]; then
  : "${STAGING_DB_OWNER_URL:?scénář turné potřebuje STAGING_DB_OWNER_URL (owner staging DB)}"
  : "${MAILPIT:?scénář turné potřebuje MAILPIT (čte PDF vstupenek z e-mailů) — na Resend stagingu nespouštět}"
  : "${CRON_SECRET:?scénář turné potřebuje CRON_SECRET stagingu}"
  log "3) scénář turné (Playwright, platby ručně v sandboxu GoPay)"
  (cd "$ROOT/e2e" && run env BASE_URL="$STAGING_URL" AUDIT_OWNER_URL="$STAGING_DB_OWNER_URL" MAILPIT="$MAILPIT" CRON_SECRET="$CRON_SECRET" \
    TOUR_PAY_MODE=manual npx playwright test tests/golden-path-r8-theatre-tour.spec.ts --project golden-path --headed --reporter=list)
fi

if [ "$SKIP_SANDBOX" = 0 ]; then
  log "4) sandbox testy GoPay a ComGate"
  (cd "$ROOT/nextjs-boilerplate" && run npm run test:sandbox)
fi
log "hotovo"
