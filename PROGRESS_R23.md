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

## Krok 1 — Wero (RED → GREEN) ⏳
## Krok 2 — soupis rout s Wero ⏳ (`2_wero_routes.md` rozpracován)
## Závěr ⏳
