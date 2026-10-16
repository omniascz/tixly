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

## Krok 1 — Wero early-guard (RED → GREEN) ⛔ ZASTAVENO (2026-10-16)
- Viz `logs/r24/1_blocked.md`. Kód nezměněn. Test-draft přesunut do `logs/r24/1_test_draft.live.test.ts.txt`.
- (w) `/api/v1/wl/orders`: `platform.whitelabel_tenants` má pod RLS jen politiku `wl_tenants_admin` (is_platform_admin) →
  `verifyWlToken` pod tixly_app vždy null → vždy 401; pro GREEN je nutná migrace → STOP dle zadání.
- (s) `/api/season-passes`: `max_per_buyer NOT NULL DEFAULT 1` + dotaz na neexistující `orders.season_passes.holder_user_id`
  (route.ts:131–136) → každý nákup 500 před INSERTem; pojistka (s) nemůže dojít k volbě platby bez změny mimo early-guard.
- (p) party-split: RED doměřen (500 + interní hláška ven), lze opravit samostatně.
- Čeká na rozhodnutí vlastníka (body 1–3 v 1_blocked.md).
## Krok 2 — modular-pass (jen čtení) ⏸ neproveden (zastaveno v kroku 1)
## Závěr ⏸ neproveden (sada, PR, sloučení — zastaveno v kroku 1)
