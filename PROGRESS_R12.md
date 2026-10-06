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

## Krok 2 — opravy (commity 5ecf3ebb … a6238c4e)
- 14 oblastí (navigace a role, seznam akcí, blokace, firemní, přesun, promo, termín bez míst v zónách, editor, inscenace,
  pokladna, skener, web, kategorie, reporty) + ConfirmDialog a errorText.
- Testy oprav F1–F12: RED 12/12 → **GREEN 12/12** (`logs/r12/2_fixes_green.txt`); tsc 0, lint bez nárůstu, unit 707.
- UX průchod před (původní kód d0bbcb00 z čistého klonu, stejný průchod) a po: `logs/r12/before`, `logs/r12/after` — po opravách
  0 zaseknutí / 0 zablokovaných úloh (před: 11 zaseknutí + 1 prompt).
- Vizuálně zkontrolováno: skener na mobilu (JINÝ TERMÍN), pokladna po prodeji, potvrzení uvolnění blokace, karta inscenace, editor.
- Nalezeno navíc: pokladna (box_office) měla na serveru přístup jako správce → zúženo jako staff; tisk v POS obsahoval TOTP tajemství.

## Krok 3 — příručky
- `docs/prirucka/` (README, pro-agenturu, pro-pokladnu, pro-vstup) s obrázky z průchodu po opravách; popisky ověřeny proti kódu.

## Závěr — lokální sada a report
- Zbylé texty z automatické kontroly (skener „ticket ID", patička „Status", aria-label editoru) → 4902a427, F8/F11/F12 RED → GREEN 12/12.
- Sada na finálním kódu (DB r12a z migrací): tsc 0, lint bez nárůstu, unit 707, live 83/83 (359), build + build bez sítě,
  audity 01–12 + 07b + 08 zelené, turné 10/10, průchod po opravách 11/11. Viz ROUND12_REPORT.md.
- Dál: PR do integrate/2026-10-04, CI + Vercel, merge, fast-forward lokálního integrate.
