# PROGRESS — kolo 21 (tokeny z URL — hlavička referer, parametry dotazu — nesmí do Sentry)

Větev `fix/round21-sentry-url-tokens-2026-10-15` z `origin/integrate/2026-10-04` (9b2e17e7). Výstupy `logs/r21/`.
Pomocné skripty `logs/r21/*.sh` = kopie kola 20 (cesty logs/r21, DB r21demo / r21a); `golden.sh` navíc předává
R21_SIM_OUT / R19_SIM_OUT a proměnné z fix.app.env.

## Krok 0 — výchozí stav ✅
- `0_state.md`: integrate lokál = origin = 9b2e17e7; master lokál 3ab73410, origin d4b43f4f; fix/round18 716fe3c9.
  Cizí commity 0, necommitnuté změny 0, PR #2 CLEAN + vše zelené, `staging.keys.env` neexistuje.
- `0_verify_r20.txt`: `telemetry: false` v withSentryConfig (next.config.mjs:236); golden-path-r20-order-confirmation **3 passed** (r21demo z migrací, tixly_app); build 0 spojení mimo localhost.
- `next-env.d.ts` build přepisuje (generovaný) — necommituje se.

## Krok 1 — soupis tajemství v URL ✅
- `1_url_secrets.md`: A (dotaz) 63 řádků (53 vlastních URL + 10 odchozích; zpráva commitu 75e5494d uvádí chybně 61), B (segment cesty) 33 (31 + 2 odchozí); seznam 27 názvů (E); `data` vyřazen.
## Krok 2 — maskování tokenů v URL (RED → GREEN) ✅
- Spec `e2e/tests/golden-path-r21-sentry-url-tokens.spec.ts` (a) reset hesla z Mailpitu, (b) kategorie?token=, (c) sentry-check 500 s ?token= a Referer.
- Oprava scrub-pii.ts: URL_SECRET_PARAMS (27), scrubText maskuje hodnotu → [skryto], referer → bez dotazu a fragmentu (událost i span), deny += seznam.
- Unit `tests/r21-sentry-url-tokens.test.ts`: RED na starém scrub-pii 15/16 selhalo (`2_unit_red.txt`), GREEN r21+r14+r19 28/28 (`2_unit_green.txt`); tsc 0, eslint obou souborů 0.
- RED (`2_red.txt`): (a) 11 obálek, (b) 14, (c) 3 — referer (span 26/26/2, událost 1), http.target 2, next.span_name 1; url.full/url.query už [Filtered] (SDK).
- GREEN (`2_green.txt`): spec beze změny 1 passed; tokeny (a)(b)(c) 0 obálek; spany s cestou reset-password 30, kategorie 38, událost (c) ano; token= jen [skryto] (23×).
- golden-path-r19-sentry11 1 passed, (d)+(e) žádné nálezy, tunel 38 spanů z prohlížeče (`2_sentry11.txt`); r13-keep+r16+r20 25 passed, token= jen [skryto] 7× (před: 2 s hodnotou) (`9_golden_summary.txt`).

## Závěr ✅
- Migrace od nuly FAILED_FILES=0 (r21a ×4: `9_build_db_r21a*.txt`), tsc 0 (`9_tsc.txt`), lint 967 / baseline 1008 (`9_lint.txt`),
  unit 735 passed + 13 skip / 80 souborů (`9_unit.txt`; R20 719 + 16 nových r21).
- Live po částech 487 passed + 1 skip / 108 souborů (`live/*.txt`: n00 83, n01 49, n02 73, n03 40, g00 163+1 skip, g01 77, webhook_pool 2).
- Build (`9_build.txt`) a build bez sítě v čistém klonu 2ca1fee9 OK (`9_build_no_network.console.txt`).
- Audity 01–12 vč. 07b a 08 0 FAIL (`9_audits_summary.txt`), turné 10/10 (`9_tour.txt`, snímky `tour/`), offline skener 6/6 (`9_offline.txt`),
  golden r13-keep + r16 + r20 25 passed (`9_golden_summary.txt`). Obálky turné: token= jen [skryto] (7×).
- golden-path-buyer / benefit nespuštěny (zadání).
- Gitleaks lokálně: 10 fingerprintů testovacích dat (`9_gitleaks_triage.md`) → .gitleaksignore; po doplnění „no leaks found".
- PR #18: CI + ruční Security 38746044263 a RLS Gate 38746111686 zelené na f24b9678, Vercel ×2 pass; sloučeno --merge → 2203c81c.
  ROUND21_REPORT.md, NEXT_STEPS.md (výsledek kola + kandidáti — tajemství v cestě).
