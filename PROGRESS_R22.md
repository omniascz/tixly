# PROGRESS — kolo 22 (obnovení CI po zveřejnění repa; tajemství pryč z api.qrserver.com)

Větev `fix/round22-qr-local-2026-10-15` z `origin/integrate/2026-10-04` (6799fb5b). Výstupy `logs/r22/`.
Pomocné skripty `logs/r22/*.sh` = kopie kola 21 (cesty logs/r22, DB r22demo / r22a; názvy proměnných R21_* ponechány).

## Krok 0 — výchozí stav, obnovení CI ✅
- `0_state.md`: integrate lokál = origin = 6799fb5b; master lokál 3ab73410, origin d4b43f4f; fix/round18 716fe3c9; repo PUBLIC.
  Cizí commity 0, necommitnuté změny 0, `staging.keys.env` neexistuje.
- `0_ci_rerun.txt`: rerun --failed 4 workflow na 6799fb5b → vše success (attempt 2, joby běžely 12 s – 3 min 8 s, kroky 5–14).
- `0_vercel.txt`: na 6799fb5b žádné nasazení Vercel (projekty pozastaveny). `0_pr2_checks.txt`: PR #2 CLEAN.
- `0_verify_r21.txt`: unit r21+r14+r19 28 passed; golden-path-r21-sentry-url-tokens 1 passed.

## Krok 1 — QR lokálně (RED → GREEN) ⏳
- 1.1 spec `e2e/tests/golden-path-r22-qr-local.spec.ts`: (a) 2FA přes /admin/settings → Zabezpečení (skutečné setup/verify),
  (b) dárek: místo z GET /api/events/504/seats + hold API, /cs/checkout s „Kupuji jako dárek" → simulátor GoPay → /cs/gift/<token>.
  Požadavky mimo localhost se zaznamenají a zahodí. Shoda QR = dekódované pixely RGBA (PNG z canvasu ≠ bajty pngjs).
  Zkušební běh `1_try1.txt` (ladění toku, stejný spec).
- 1.2 RED ✅ `1_red.txt`: (a1) 1 požadavek na api.qrserver.com s otpauth+secretBase32, (b1) 1 s qrPayload+secret vstupenky;
  (a2)(b2) src = URL qrserveru, natural 0×0; (a3) verify 200. Snímky `shots/1_red_*.png` (QR a ruční kód zamaskovány).
