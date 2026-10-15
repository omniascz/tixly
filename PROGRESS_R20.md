# PROGRESS — kolo 20 (pád order-confirmation `event_date_start.replace`, telemetrie build pluginu Sentry)

Větev `fix/round20-order-confirmation-2026-10-15` z `origin/integrate/2026-10-04` (da9a8aeb). Výstupy `logs/r20/`.

## Krok 0 — výchozí stav ✅
- `0_state.md`: integrate lokál = origin = da9a8aeb; master lokál 3ab73410, origin d4b43f4f; fix/round18 716fe3c9.
  Cizí commity 0, necommitnuté změny 0, PR #2 CLEAN + vše zelené, `staging.keys.env` neexistuje.
- `0_verify_r19.txt`: @sentry/nextjs 11.7.0, r14 5/5 + r19 7/7.

## Krok 1 — pád stránky potvrzení (RED → GREEN) ✅ (turné ověřeno v závěrečné sadě)
- Spec `e2e/tests/golden-path-r20-order-confirmation.spec.ts` (next start :3200 nad r20demo z migrací, tixly_app + RLS,
  nákup přes simulátor GoPay; nic nemockováno). Skripty `logs/r20/golden.sh <štítek> <spec…>` (reset r20demo, GoPay :3998,
  Sentry :3995, server; R20_NO_RESET=1 / R20_DB=…), `serve_r20.sh`, `stop_mine.sh`, `rich_from_dev.sh`.
- RED (`1_red.txt`, commit 0b8e8a3b): (a) 500, (b) 2× TypeError, (c) 0 odkazů; (d) a (null) zelené i na starém kódu.
- Oprava page.tsx: typ `Date | string | null`, `eventStartIso` = `new Date(..).toISOString()`, `gcalStart` = YYYYMMDDTHHMMSSZ;
  formatDate dostává ISO téhož okamžiku (výstup stejný). paid_at/expires_at beze změny (žádná metoda řetězce; expires_at přes new Date).
- GREEN (`1_green.txt`): 3/3, dates=20261119T190000Z/… = date_start z DB, 0 TypeError. tsc 0 (`1_tsc.txt`); lint souboru 3 chyby import/order = stejné jako před změnou.
- Grep 1.4 (`1_grep_dates.md`): 18 výskytů, 0 kandidátů (všechny `::text` nebo JSON).
- golden-path-buyer / benefit: červené z důvodů mimo kolo (zastaralé texty UI, CSRF bez Origin, kód chyby) — viz `1_green.txt`; DB r20rich.
## Krok 2 — telemetrie build pluginu Sentry ✅
- `logs/r20/2_telemetry.sh <štítek>`: npm run build, oba DSN na 127.0.0.1:3995, bez auth tokenu, net-guard (NODE_OPTIONS).
- RED (`2_red.txt`, 524ed2ad): 5× BLOCKED connect o1.ingest.sentry.io:443 (telemetry.js DSN pluginu); build s opravou kroku 1: 3×.
- Oprava d206dd6c: `telemetry: false` + komentář Kolo 20 (jediná změna konfigurace Sentry).
- GREEN (`2_green.txt`): 0 spojení mimo localhost; routy identické s logs/r19 (1124 / 1119 ƒ / 5 ○).
- r19-sentry-scrub + golden-path-r19-sentry11: v závěru (sentry spec potřebuje build s klientským DSN ve tvaru SaaS + tunel jako K19).

## Závěr ⏳
- Hotovo (30160486): turné 10/10 (2. běh; 0× event_date_start.replace), golden r13-keep + r16 22/22, offline 6/6, audity 0 FAIL,
  migrace od nuly FAILED_FILES=0 (r20a). Pak tsc 0 (`9_tsc.txt`), lint 967/1008 (`9_lint.txt`), unit 719 passed / 13 skipped (`9_unit.txt`).
- Běží: live (`run_live.sh`). Zbývá: build bez sítě v čistém klonu, sentry build + spec r19-sentry11 + unit r19, PR, CI, merge, report.
