#!/usr/bin/env bash
# Kolo 12: čistá DB → server → UX průchod. $1 = before|after. Server se po průchodu nechá běžet (ukončuje volající).
set -u
cd /c/Users/omnia/Documents/tixly
bash logs/r12/reset_demo.sh > "logs/r12/0_reset_$1.txt" 2>&1 || { echo reset-fail; exit 1; }
cd nextjs-boilerplate
(bash ../logs/r12/serve_r12.sh > "../logs/r12/0_server_$1.txt" 2>&1 &)
for i in $(seq 1 40); do c=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3200/api/health/db); [ "$c" = 200 ] && break; sleep 3; done
echo "health=$c"
cd ../e2e
rm -rf "../logs/r12/$1" test-results
BASE_URL=http://localhost:3200 AUDIT_OWNER_URL=postgresql://neondb_owner:fixowner@localhost:55632/r12demo UX_OUT="../logs/r12/$1" \
  timeout 2400 npx playwright test tests/golden-path-r12-ux-walkthrough.spec.ts --project golden-path --reporter=line > "../logs/r12/1_walkthrough_$1.txt" 2>&1
echo "exit=$?"
