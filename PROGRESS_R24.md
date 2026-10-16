# PROGRESS — kolo 24 (Wero early-guard ve zbylých API cestách: season-passes, party-split, v1/wl/orders)

Větev `fix/round24-wero-routes-2026-10-16` z `origin/integrate/2026-10-04` (80eea362). Výstupy `logs/r24/`.
Pomocné skripty `logs/r24/*.sh` = kopie kola 23 (cesty logs/r24, DB r24demo / r24a; `serve_r24.sh` + `R24_ALLOW_MOCK=1` = konfigurace D,
jinak ALLOW_MOCK_PAYMENTS odstraněna = P); `stop_mine.ps1` ukončí jen procesy této session.

## Krok 0 — výchozí stav a ověření Kola 23 ✅
- `0_state.md`: integrate lokál = origin = 80eea362; master lokál 3ab73410, origin d4b43f4f; fix/round18 716fe3c9; repo PUBLIC;
  cizí commity 0; necommitnuté změny 0; staging.keys.env neexistuje (ignorován, .gitignore:105).
- `0_checks.txt`: CI 38881430350, RLS Gate 38881430355, Security 38881430336, Schema Drift 38881430361 success; RLS produkce skipped;
  Vercel ×2 „Deployment was blocked"; PR #2 OPEN MERGEABLE UNSTABLE.
- `0_verify_r23.txt`: build 80eea362 rc=0 (`0_build.txt`); golden-path-r23-wero P 1 passed, D 1 passed; live r23-wero-ticket-types 6 passed.

## Krok 1 — Wero early-guard (RED → GREEN) ⏳
## Krok 2 — modular-pass (jen čtení) ⏳
## Závěr ⏳
