# Kolo 22 — triáž Gitleaks (lokální `gitleaks git --log-opts=origin/integrate/2026-10-04..HEAD --redact`, před pushem 63efb0e6)

Report `logs/r22/9_gitleaks_local.json` (hodnoty redigované gitleaksem). 10 hlášení = 5 fingerprintů, vše pravidlo
`generic-api-key`, vše v souborech kola 22 (výstupy lokálních testů). Triáž podle názvu klíče, kontextu a původu hodnoty
(hodnoty nevypisovány). Skutečné tajemství: **0**. Spec, oprava ani skripty kola 22 nález nemají.

| fingerprint | soubor, typ hodnoty | proč nejde o tajemství | verdikt |
|---|---|---|---|
| `63efb0e6…:audit/logs/r22_e2e_03_refund_scan.jsonl:generic-api-key:4` | `idempotency_key` testovací objednávky auditu 03 (6 hlášení na jednom řádku, náhodná UUID) | lokální r22a z migrací (po auditu znovu založena); stejný typ jako K19–K21 | testovací |
| `63efb0e6…:logs/r22/live/g01.txt:generic-api-key:167` | výstup live testu party-split, `shareToken` | token vytvořený testem v lokální DB r22a (localhost:3100), DB znovu založena; stejný typ jako K20/K21 | testovací |
| `63efb0e6…:logs/r22/live/n03.txt:generic-api-key:38` | výstup live testu, `token` převodu vstupenky | token převodu v lokální r22a, test ho sám vytváří; stejný typ jako K21 | testovací |
| `63efb0e6…:logs/r22/live/n03.txt:generic-api-key:106` | výstup live testu, `token` (tělo požadavku, akce PUB-…) | lokální r22a, vytvořeno testem | testovací |
| `63efb0e6…:logs/r22/live/n03.txt:generic-api-key:112` | totéž | totéž | testovací |

QR tajemství kola 22 (otpauth / secretBase32 2FA, qrPayload a token dárku): v logs/r22 jen maskovaně (4 znaky);
ověřeno grepem `otpauth://`, `secret=[A-Z2-7]{8}` a `/gift/<token>` — 0 výskytů. Snímky mají QR a ruční kód zamaskované.
Po doplnění 5 fingerprintů do `.gitleaksignore`: `gitleaks git` na rozsahu větve → „no leaks found" (viz commit R22-9b).
