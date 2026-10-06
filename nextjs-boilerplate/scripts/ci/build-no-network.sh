#!/usr/bin/env bash
# scripts/ci/build-no-network.sh — kolo 11 / krok 2: čistý `next build` bez přístupu k síti.
#
# Vercel build (dpl_HWWquhd3qMF8yL6ShQXxJ4f713K8) padal, protože Next předgeneroval routu, která se při buildu
# připojovala k Redisu — spojení tam viselo. Tady:
#   1) všechny proměnné z .env.example jsou prázdné, síťové (DB, Redis, *_HOST, *_URL…) ukazují na nesměrovatelnou
#      adresu 10.255.255.1, kde spojení VISÍ (ne okamžitě odmítnuto — přesně situace na Vercelu);
#   2) NODE_OPTIONS načte scripts/ci/no-network-preload.cjs — jakýkoli pokus o spojení z kódu aplikace build
#      okamžitě ukončí s cílem, routou a stacktracem (výjimka: písma next/font/google).
# Spouští se z nextjs-boilerplate/ (CI job „Build bez sítě"). Výstup: build-no-network.log.
set -euo pipefail
cd "$(dirname "$0")/../.."
BH=10.255.255.1
LOG="${BUILD_LOG:-build-no-network.log}"
HERE="$PWD"; command -v cygpath >/dev/null 2>&1 && HERE=$(cygpath -m "$PWD") # Git Bash na Windows: node potřebuje C:/…
export BUILD_NET_LOG="$HERE/build-no-network.violations.log"
rm -f "$BUILD_NET_LOG"
for f in .env .env.local .env.production .env.production.local; do
  [ ! -e "$f" ] || { echo "::error::$f existuje — build bez sítě spouštěj v čistém klonu (bez lokálních .env)" >&2; exit 2; }
done

while IFS= read -r k; do
  case "$k" in
    DATABASE_URL*|POSTGRES_URL*) export "$k=postgresql://u:p@$BH:5432/x" ;;
    REDIS_URL|KV_URL) export "$k=redis://$BH:6379" ;;
    SENTRY_DSN|NEXT_PUBLIC_SENTRY_DSN) export "$k=" ;; # s DSN by se zapnul upload source map (síť)
    *_HOST) export "$k=$BH" ;;
    *_URL|*_ENDPOINT|*_DSN) export "$k=http://$BH" ;;
    *) export "$k=" ;;
  esac
done < <(grep -E '^[A-Z_][A-Z0-9_]*=' .env.example | cut -d= -f1 | sort -u)
# proměnné, které .env.example nemá, ale kód je čte
export DATABASE_URL_DIRECT="postgresql://u:p@$BH:5432/x" DATABASE_URL_SUPER="postgresql://u:p@$BH:5432/x" \
  DATABASE_URL_OPS="postgresql://u:p@$BH:5432/x" KV_REST_API_URL="http://$BH" SMTP_HOST="$BH"
export NEXT_TELEMETRY_DISABLED=1 CI=1
export NODE_OPTIONS="${NODE_OPTIONS:-} --require $HERE/scripts/ci/no-network-preload.cjs"

echo "[build-no-network] DATABASE_URL=$DATABASE_URL REDIS_URL=${REDIS_URL:-} SMTP_HOST=$SMTP_HOST"
set +e
# prebuild + next build přímo (ne přes npm — npm by pod preloadem mohl sám kontaktovat registr)
{ node scripts/copy-pdf-worker.mjs && node node_modules/next/dist/bin/next build; } 2>&1 | tee "$LOG"
rc=${PIPESTATUS[0]}
set -e
if [ -s "$BUILD_NET_LOG" ]; then
  echo
  echo "::error::Build se pokusil o síťové spojení — routa/stránka se předgenerovává a sahá na síť:"
  grep -E '\[no-network-build\] (ZAKÁZANÉ|routa)' "$BUILD_NET_LOG" | sort -u
  exit 1
fi
if [ "$rc" != 0 ]; then
  echo "::error::next build selhal (kód $rc) — viz $LOG"
  grep -E 'timing out|Error occurred prerendering|Export encountered' "$LOG" | head -20 || true
  exit "$rc"
fi
echo "[build-no-network] OK — build prošel bez jediného síťového spojení z kódu aplikace"
