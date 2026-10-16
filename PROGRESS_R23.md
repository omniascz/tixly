# PROGRESS — kolo 23 (sloučení K22 podle varianty A; Wero jen tam, kde je mock brána povolená)

Větev `fix/round23-wero-2026-10-16` z `origin/integrate/2026-10-04` po sloučení PR #19 (514b1215). Výstupy `logs/r23/`.
Pomocné skripty `logs/r23/*.sh` = kopie kola 22 (cesty logs/r23, DB r23demo / r23a; proměnné R21_* ponechány);
`serve_r23.sh` + přepínač `R23_ALLOW_MOCK=1` (konfigurace D), jinak `ALLOW_MOCK_PAYMENTS` odstraněna (konfigurace P);
`stop_mine.ps1` ukončí simulátor GoPay jen tehdy, je-li jeho rodič skript z logs/r23.

## Krok 0 — výchozí stav, sloučení PR #19 ✅
- `0_state.md`: integrate lokál = origin = 6799fb5b; master lokál 3ab73410, origin d4b43f4f; fix/round18 716fe3c9; head PR #19 03ddf755;
  repo PUBLIC; cizí commity 0; necommitnuté změny 0.
- `0_pr19_build.txt`: `git diff 5696a8f5 03ddf755 -- nextjs-boilerplate e2e` prázdný → build K22 (logs/r22/1_green_build.txt,
  9_build_no_network.console.txt) platí.
- `0_pr19_checks.txt`: ruční Security 38864262906 (5 jobů, kroky 5–8) a RLS Gate 38864266050 (DB z migrací 11 kroků; produkce skipped)
  na 03ddf755 success; CI 38808832709 + Schema drift 38808840007 success; Vercel ×2 „Deployment was blocked".
- Sloučeno `gh pr merge 19 --merge` → **514b1215**; tixly/ integrate ff na 514b1215.
- `0_after_merge.txt`: běhy na 514b1215 (pull_request PR #2): CI 38864481449, RLS Gate 38864481419, Security 38864481417,
  Schema Drift 38864481412 — vše success; `gh pr checks 2`: joby GitHubu pass, RLS produkce skipping, Vercel ×2 blocked.
- `0_cleanup.txt`: %TEMP%\r22-clean (samostatný klon, ne worktree, 0 procesů, 2757 MB) smazán; staging.keys.env neexistuje (ignorován).
- Build 514b1215 (`0_build.txt`, 1. pokus `0_build_try1_timeout.txt` přerušen limitem 10 min při generování stránek) rc=0.
- `0_verify_r22.txt`: golden-path-r22-qr-local 2 passed (spec má 2 testy), 0 požadavků mimo localhost; grep api.qrserver.com v src → jen kiosk-display/page.tsx:21.

## Krok 1 — Wero (RED → GREEN) ✅
- 1.1 spec `e2e/tests/golden-path-r23-wero.spec.ts` ((P) a/b + pojistka gopay, (D) c; výběr přes -g); live test `tests/r23-wero-ticket-types.live.test.ts`.
- 1.2 RED ✅ (86f1287b, `1_red.txt`): P — wero input 1, 500, objednávek 0→1, {59,held}→{58,sold}; D 1 passed; live 6 failed.
- 1.3 oprava (`1_fix_diff.txt`): checkout/route.ts early-guard 503 před BEGIN; ticket-types weroAvailable; page.tsx stav weroAvailable. tsc 0, lint 29 = 29.
- 1.4 GREEN ✅ (`1_green.txt`): P 1 passed (503, 0→0, {59,held}={59,held}), D 1 passed, live 6 passed; snímky D 0 px, P −4 px výšky řady (`1_shots_compare.txt`).
## Krok 2 — soupis rout s Wero ✅
- `2_wero_routes.md`: 4 routy + hlavní checkout; záznam před createPayment s wero v produkci jen `POST /api/season-passes` (COMMIT :185 → createPayment :188), bez UI;
  party-split/[token] a v1/wl/orders createPayment uvnitř transakce před INSERTem (ROLLBACK); modular-pass createPayment nevolá vůbec (vždy /mock-gopay). Kód nezměněn.
## Závěr — kompletní lokální sada ✅ (kód 100913b8; src = 315a2930)
- Migrace od nuly FAILED_FILES=0 (r23a: 1_build_db_r23a, 9_build_db_r23a_live, _live_g, _tour_try1, _tour_try2, _tour; r23demo v každém golden bloku).
- tsc 0 (`9_tsc.txt`), lint 967 / baseline 1008 (`9_lint.txt`), unit 735 passed + 13 skip / 80 souborů (`9_unit.txt`).
- Live 493 passed + 1 skip (`9_live_summary.txt`: n00 83, n01 49, n02 73, n03 46, webhook_pool 2, g00 163+1 skip, g01 77).
- Build `1_green_build.txt` (kód src = HEAD), build bez sítě v čistém klonu 100913b8 OK (`9_build_no_network.console.txt`);
  klon %TEMP%\r23-clean po buildu smazán.
- Audity 01–12 vč. 07b a 08: 0 FAIL (`9_audits_summary.txt`).
- Turné 10/10 na 3. pokus (`9_tour.txt`, `tour/`); pokusy 1 a 2 selhaly v testu 3 na známém souběhu blokací (:422:42, block-create disabled).
- Golden (`9_golden_summary.txt`): blok A r13-keep 10 + r16 12 + r20 3 + r21 1 = 26 passed (token= s hodnotou 0); blok B r22 2 + r23 (P) 1;
  blok C r23 (D) 1. 1. pokus (všech 5 v jednom bloku) 26 passed + 2 failed: r22 (b) 404 po zrušení termínu 504 specem r13-keep,
  r16 pojistka hydratace.
- Offline skener 6/6 (`9_offline.txt`). golden-path-buyer / benefit nespuštěny (zadání).
- Gitleaks lokálně: 5 fingerprintů testovacích dat v 0888caa3 (`9_gitleaks_triage.md`) → .gitleaksignore; po doplnění „no leaks found".
- PR → integrate ⏳
