# Kolo 20 — triáž Gitleaks (Security, ruční běh 38724541085 na 279e1c6a)

`workflow_dispatch` skenuje celou historii (984 commitů): 29 hlášení = 9 fingerprintů, vše pravidlo `generic-api-key`, vše
v souborech kola 20. Triáž jen podle názvů klíčů, délek a kontextu (hodnoty nevypisovány, max. 4 maskované znaky v pracovním
výstupu, ne zde). Skutečné tajemství: **0**.

| fingerprint | soubor, typ hodnoty | proč nejde o tajemství | verdikt |
|---|---|---|---|
| `02d0d70d…:logs/r20/live/g01.txt:generic-api-key:165` | výstup live testu, `shareToken` party-split | token vytvořený testem v lokální DB r20a z migrací (po běhu znovu založena), nikde jinde neplatí; stejný typ jako K19 oddíl 2 | testovací |
| `02d0d70d…:logs/r20/live/g01_bez_gopay.txt:generic-api-key:41` | totéž (běh g01 bez simulátoru GoPay) | totéž | testovací |
| `02d0d70d…:logs/r20/live/n03.txt:generic-api-key:38` | výstup live testu, `token` převodu vstupenky (`toEmail` cizi-…) | token převodu v lokální r20a, test ho sám vytváří; stejný typ jako K19 | testovací |
| `02d0d70d…:logs/r20/live/n03.txt:generic-api-key:106` | totéž | totéž | testovací |
| `02d0d70d…:logs/r20/live/n03.txt:generic-api-key:112` | totéž | totéž | testovací |
| `30160486…:audit/logs/r20_e2e_03_refund_scan.jsonl:generic-api-key:4` | `idempotency_key` testovací objednávky auditu 03 (náhodné UUID) | lokální r20a; stejný typ jako r2 (kolo 5) a r19 | testovací |
| `30160486…:logs/r20/9_golden_envelopes.jsonl:generic-api-key:134` | obálka simulátoru Sentry: `sentry_key` = veřejný klíč DSN simulátoru `r20publickey` (logs/r20/serve_r20.sh) a `token` v URL referer `/cs/reset-password?token=…` testu golden-path-r13-keep | DSN simulátoru je smyšlený řetězec; reset token jednorázový v demo DB r20demo (před každým během znovu založena) | testovací |
| `30160486…:logs/r20/9_golden_envelopes.jsonl:generic-api-key:136` | totéž | totéž | testovací |
| `30160486…:logs/r20/fixture_offline.json:generic-api-key:1` | fixture specu offline skeneru: `t.*.secret` (QR tajemství testovacích vstupenek), `gate` | lokální demo DB r20demo, znovu zakládána; stejný typ jako `logs/r19/fixture_offline.json` | testovací |

Postřeh mimo rozsah kola (kandidát na další kolo): serverový span Sentry nese atribut `http.request.header.referer` s plnou URL
včetně dotazu (zde reset token z `/cs/reset-password?token=`). `scrub-pii.ts` hlavičku referer nemaže; v K19 se v obálkách
neobjevila (vzorkování `tracesSampleRate: 0.1` je náhodné). Neopravováno.
