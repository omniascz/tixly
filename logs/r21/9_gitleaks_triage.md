# Kolo 21 — triáž Gitleaks (lokální `gitleaks git --log-opts=origin/integrate/2026-10-04..HEAD --redact`, před pushem 972844ab)

Report `logs/r21/9_gitleaks_local.json` (hodnoty redigované gitleaksem). 16 hlášení = 10 fingerprintů, vše pravidlo
`generic-api-key`, vše v souborech kola 21. Triáž podle názvu klíče, kontextu a původu hodnoty (hodnoty nevypisovány).
Skutečné tajemství: **0**.

| fingerprint | soubor, typ hodnoty | proč nejde o tajemství | verdikt |
|---|---|---|---|
| `b7af4622…:logs/r21/2_unit_red.txt:generic-api-key:46` | výstup unit testu RED: `token=` s konstantou `TOK` z `tests/r21-sentry-url-tokens.test.ts` | smyšlený 32znakový hex řetězec v testu (je v repozitáři ve zdrojáku testu), nikde neplatí | testovací |
| `b7af4622…:logs/r21/2_unit_red.txt:generic-api-key:58` | totéž (`/x?token=TOK`) | totéž | testovací |
| `b7af4622…:logs/r21/2_unit_red.txt:generic-api-key:59` | totéž (`/x?token=TOK%2B%2F%3D`) | totéž | testovací |
| `b7af4622…:logs/r21/2_unit_red.txt:generic-api-key:97` | totéž (`access_token`/`refresh_token` = TOK) | totéž | testovací |
| `b7af4622…:logs/r21/2_unit_red.txt:generic-api-key:237` | totéž (událost `request.url`/`query_string` = TOK) | totéž | testovací |
| `972844ab…:audit/logs/r21_e2e_03_refund_scan.jsonl:generic-api-key:4` | `idempotency_key` testovací objednávky auditu 03 (náhodné UUID) | lokální r21a z migrací (znovu zakládána); stejný typ jako r20 (kolo 20) a r19 | testovací |
| `972844ab…:logs/r21/live/g01.txt:generic-api-key:165` | výstup live testu, `shareToken` party-split | token vytvořený testem v lokální DB r21a, po běhu DB znovu založena; stejný typ jako K20 | testovací |
| `972844ab…:logs/r21/live/n03.txt:generic-api-key:38` | výstup live testu, `token` převodu vstupenky | token převodu v lokální r21a, test ho sám vytváří; stejný typ jako K20 | testovací |
| `972844ab…:logs/r21/live/n03.txt:generic-api-key:102` | výstup live testu, `token` (tělo požadavku, akce PUB-…) | lokální r21a, vytvořeno testem | testovací |
| `972844ab…:logs/r21/live/n03.txt:generic-api-key:108` | totéž | totéž | testovací |

Pozn.: v kole 20 hlášené obálky simulátoru Sentry s reset tokenem v refereru se v kole 21 neopakují — `redact.mjs` maskuje
hodnoty tokenů v dotazu URL (4 znaky) a po opravě je SDK do obálek vůbec neposílá (`2_green.txt`).
