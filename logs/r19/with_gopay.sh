#!/usr/bin/env bash
# Kolo 19 — spustí simulátor GoPay (:3998) jen po dobu příkazu, pak ho ukončí.
cd /c/Users/omnia/Documents/tixly/nextjs-boilerplate
node tests/helpers/fake-gopay.mjs >> ../logs/r19/fake_gopay.txt 2>&1 &
GP=$!
for _ in $(seq 1 30); do curl -s -o /dev/null http://localhost:3998/ && break; sleep 0.5; done
"$@"; rc=$?
kill $GP 2>/dev/null; wait $GP 2>/dev/null
exit $rc
