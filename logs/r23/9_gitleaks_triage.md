# Kolo 23 — triáž Gitleaks (lokální `gitleaks git --log-opts=origin/integrate/2026-10-04..HEAD --redact`, před pushem 0888caa3)

Report `logs/r23/9_gitleaks_local.json` (hodnoty redigované gitleaksem: Secret = REDACTED). 10 hlášení = 5 fingerprintů, vše pravidlo
`generic-api-key`, vše v souborech kola 23 s výstupy lokálních testů (commit 0888caa3). Triáž podle názvu klíče, kontextu řádku
a původu hodnoty (hodnoty nevypisovány). Skutečné tajemství: **0**. Spec, oprava (3 soubory src), live test ani skripty kola 23 nález nemají
(stejný sken na commitech 33f548b2…100913b8 před 0888caa3: 0 hlášení — pushnuté commity prošly i CI Gitleaks na PR).

| fingerprint | soubor, typ hodnoty | proč nejde o tajemství | verdikt |
|---|---|---|---|
| `0888caa3…:audit/logs/r23_e2e_03_refund_scan.jsonl:generic-api-key:4` | `idempotency_key` testovací objednávky auditu 03 (6 hlášení na jednom řádku, audit_log/new_values, náhodná UUID) | lokální r23a z migrací (localhost:55632, DB se při každém bloku zakládá znovu); stejný typ jako K19–K22 (`63efb0e6…:audit/logs/r22_e2e_03_refund_scan.jsonl:…:4`) | testovací |
| `0888caa3…:logs/r23/live/g01.txt:generic-api-key:165` | výstup live testu `[party-split create] 201`, `shareToken` | token vytvořený testem v lokální DB (shareUrl `http://localhost:3100/party/…`), DB znovu založena; stejný typ jako K22 `logs/r22/live/g01.txt:167` | testovací |
| `0888caa3…:logs/r23/live/n03.txt:generic-api-key:38` | výstup live testu `[my/tickets/transfer POST] 201`, `token` převodu vstupenky (adresy `@tixly.test`) | token převodu v lokální r23a, test ho sám vytváří; stejný typ jako K22 `n03.txt:38` | testovací |
| `0888caa3…:logs/r23/live/n03.txt:generic-api-key:100` | výstup live testu, `body: '{"token":…,"eventTitle":"PUB-…"}'` | lokální r23a, vytvořeno testem (akce PUB-… ze seed factory); stejný typ jako K22 `n03.txt:106` | testovací |
| `0888caa3…:logs/r23/live/n03.txt:generic-api-key:106` | totéž | totéž (K22 `n03.txt:112`) | testovací |

Posun řádků oproti K22 (n03 100/106 místo 106/112, g01 165 místo 167): část n03 má navíc nový live test kola 23
a výstupy se liší pořadím/délkou; typ a původ hodnot jsou stejné.

Tajemství z fix.app.env (JWT_SECRET, ENCRYPTION_KEY, INTERNAL_SERVICE_TOKEN, CRON_SECRET, GOPAY_CLIENT_SECRET) a JWT: `node logs/r23/redact.mjs`
před každým commitem — 0 náhrad (hodnoty v logs/r23 nejsou).
Pozn.: při triáži se mi do konverzace (ne do repozitáře nad rámec commitnutého logu) dostala shareUrl s testovacím party-split tokenem
z lokální DB r23a (localhost:3100); nejde o skutečné tajemství, DB se zakládá znovu.
