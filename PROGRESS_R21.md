# PROGRESS — kolo 21 (tokeny z URL — hlavička referer, parametry dotazu — nesmí do Sentry)

Větev `fix/round21-sentry-url-tokens-2026-10-15` z `origin/integrate/2026-10-04` (9b2e17e7). Výstupy `logs/r21/`.
Pomocné skripty `logs/r21/*.sh` = kopie kola 20 (cesty logs/r21, DB r21demo / r21a); `golden.sh` navíc předává
R21_SIM_OUT / R19_SIM_OUT a proměnné z fix.app.env.

## Krok 0 — výchozí stav ✅
- `0_state.md`: integrate lokál = origin = 9b2e17e7; master lokál 3ab73410, origin d4b43f4f; fix/round18 716fe3c9.
  Cizí commity 0, necommitnuté změny 0, PR #2 CLEAN + vše zelené, `staging.keys.env` neexistuje.
- `0_verify_r20.txt`: `telemetry: false` v withSentryConfig (next.config.mjs:236); golden-path-r20-order-confirmation **3 passed** (r21demo z migrací, tixly_app); build 0 spojení mimo localhost.
- `next-env.d.ts` build přepisuje (generovaný) — necommituje se.

## Krok 1 — soupis tajemství v URL ⏳
## Krok 2 — maskování tokenů v URL (RED → GREEN) ⏳
## Závěr ⏳
