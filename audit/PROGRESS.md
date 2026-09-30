# PROGRESS — audit Tixly (větev `audit/2026-09-30`, HEAD `d4b43f4`)

Stav k navazující session. „Hotovo" = výstup je doložen souborem v `audit/`.

| Fáze | Stav | Doložené výstupy |
|---|---|---|
| 1 — plán | HOTOVO | `audit/phase1_plan.md` (65 core + 18 non-core řádků se zdroji) |
| 2 — inventura kódu | HOTOVO (statická) | `audit/phase2_inventory.md` (sekce A–F, file:line) |
| 3 — kvalita testů | HOTOVO | `logs/01`–`07d` (install, tsc, eslint, prettier, vitest, coverage), `logs/09` (live sada proti izolované DB), `logs/10a`,`10b` (build), `logs/11` (mutační sonda, 6 mutací, vše vráceno) |
| 4 — E2E | HOTOVO s výjimkami | `logs/02`,`03`,`17` (migrace od nuly 2×), `logs/08`,`08b` (drift guard + umělý drift), `logs/e2e_01`–`e2e_09` |
| 5 — bezpečnost | HOTOVO s výjimkami | `logs/12_r56_*` (R-56), `logs/e2e_06`,`e2e_07`,`e2e_07b`,`e2e_08` (RLS, IDOR, tokeny, CSRF, rate limit), `logs/13` (gitleaks), `logs/14` (npm audit), `logs/16*` (GitHub CI) |

## Výjimky (v reportu vedené jako NEOVĚŘENO)
- Fáze 4: offline fronta skeneru v prohlížeči (IndexedDB) — ověřen jen serverový manifest. POS/pokladna, guestlist, comps — netestováno.
- Fáze 5: regrese „výpadek gate" (guestlist check-in, cross-pass) za běhu — jen statický důkaz (`logs/08`, self-test GREEN). Řetězec přes voucher / upgrade / resale „demo" cesty — jen čtení kódu.
- Produkce: role DB, env proměnné, nasazený commit — na produkci se audit nepřipojoval; Vercel API bylo nedostupné.

## Prostředí
- Izolovaná DB z první session byla po doběhnutí smazána. V navazující session postavena znovu z migrací: `logs/17_migrate_from_zero_session2.log` (24/24 OK, 632 policies — shodné s `logs/02`,`03`).
- Aplikační servery z první session skončily na časovém limitu; nové měření už nebylo potřeba.

## Zbývá
- [x] AUDIT_REPORT.md kompletní (7 částí, commit 1a46993)
- [x] všechny důkazy + report commitnuty na audit/2026-09-30
