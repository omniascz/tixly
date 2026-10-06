# PROGRESS — kolo 12 (provozní příručka a UX průchod administrací)

Větev `fix/round12-ux-2026-10-06` z `d0bbcb00`. Výstupy a screenshoty `logs/r12/`.

## Příprava
- `scripts/staging/create.sh --local` → DB `r12demo` (demo agentura demo@tixly-staging.test: Brno + Ostrava, Racek + Hamlet,
  4 termíny, 400 míst, 20 kategorií, 24 blokovaných); tixly_app NOBYPASSRLS, 871 politik. `logs/r12/0_create_local.txt`.
- Build aplikace OK (`logs/r12/0_app_build.txt`); server `logs/r12/serve_r12.sh` (:3200), simulátor GoPay :3998, Mailpit :58225.

## Krok 1 — UX průchod (stav před opravami)
- `e2e/tests/golden-path-r12-ux-walkthrough.spec.ts` + `e2e/tests/helpers/ux-meter.ts`: 8 úloh vlastníka, kupec (mobil 390), pokladní,
  obsluha vstupu (mobil); jen klikáním z /admin; kliknutí, obrazovky, screenshoty 1440/390, automatické nálezy (EN, technické termíny,
  kódy, ID, prompt/confirm). Čistá DB před každým během (`logs/r12/reset_demo.sh`, `run_walkthrough.sh`).
- Výsledek: `logs/r12/before/ux-results.json`, screenshoty `logs/r12/before/`, souhrn automatických nálezů `1_auto_findings_before.txt`.
- Hlavní zaseknutí (ruční posouzení screenshotů): viz ROUND12_REPORT.md; klíčové — termín v sále bez zón „V prodeji (0 míst)",
  blokace celé sekce bez volných míst = prázdná blokace, výpadek sítě u vstupu = zelené „vpuštěno" bez ověření, zrušený termín „Prodej"
  v seznamu akcí, mobil: menu 240 px z 390, seznamy termínů bez města (pokladní vybrala špatný termín), přesun/uvolnění bez potvrzení,
  prompt okna, anglické texty (editor, skener, seznam akcí, POS), tisk v POS s TOTP tajemstvím místo QR, Inscenace/Promo kódy jen přes „Vše".
- Testy oprav `e2e/tests/golden-path-r12-ux-fixes.spec.ts` (F1–F12): **RED 12/12** (`logs/r12/2_fixes_red.txt`).
