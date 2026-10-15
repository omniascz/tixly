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
- 1.3 oprava ✅ (`1_fix_diff.txt`): TwoFactorSettings.tsx a gift/[token]/page.tsx — `QRCode.toDataURL(…, { width: 180 | 220, margin: 4 })`
  v prohlížeči do src stávajícího `<img>`; chyba generování → QR se nezobrazí (2FA: ruční kód zůstává). Komentář + JSDoc bod 3 opraveny.
  tsc 0 (`1_tsc.txt`); eslint obou souborů = stejné nálezy jako před změnou (`1_lint_files.txt` vs `1_lint_orig.txt`).
- 1.4 GREEN ✅ `1_green.txt`: spec beze změny 2 passed; 0 požadavků mimo localhost; pixely QR shodné; grep qrserver jen kiosk-display;
  snímky RED × GREEN: umístění a velikost QR shodné (dárek 0 px rozdíl, 2FA 5 px mimo QR — okraj pole pro kód).

## Závěr — kompletní lokální sada ✅ (kód 5696a8f5)
- Migrace od nuly FAILED_FILES=0 (r22a ×5: `9_build_db_r22a*.txt`), tsc 0 (`9_tsc.txt`), lint 967 / baseline 1008 (`9_lint.txt`),
  unit 735 passed + 13 skip / 80 souborů (`9_unit.txt`).
- Live po částech 487 passed + 1 skip (`live/*.txt`: n00 83, n01 49, n02 73, n03 40, g00 163+1 skip, g01 77, webhook_pool 2).
- Build `1_green_build.txt` (stejný kód src), build bez sítě v čistém klonu 5696a8f5 OK (`9_build_no_network.console.txt`).
- Audity 01–12 vč. 07b a 08: 0 FAIL (`9_audits_summary.txt`).
- Turné 10/10 (`9_tour.txt`, snímky `tour/`) — 3. pokus: 1. pokus selhal v testu 3 na souběhu v testu blokací
  (`9_tour_try1.txt`; blokace/page.tsx nuluje název až po `await load()`), 2. pokus nedoběhl — Docker/WSL VM ukončen zvenčí
  ve 22:33:11 (`9_tour_try2_docker_down.txt`); Docker Desktop znovu spuštěn touto session, kontejnery fix-pg/fix-redis/fix-mail
  nastartovány (`docker start`), fm-* (jiný projekt) nedotčeny.
- Golden r13-keep 10 + r16 12 + r20 3 + r21 1 = 26 passed (`9_golden_summary.txt`; token= v obálkách 0 s hodnotou, 23× [skryto]);
  offline skener 6/6 (`9_offline.txt`). golden-path-buyer / benefit nespuštěny (zadání).
- Gitleaks lokálně: 5 fingerprintů testovacích dat (`9_gitleaks_triage.md`) → .gitleaksignore; po doplnění „no leaks found".
