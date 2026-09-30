# PROGRESS — audit Tixly (větev `audit/2026-09-30`, auditovaný commit `d4b43f4`)

„Hotovo" = výstup je doložen souborem v `audit/`. Session 3 = navazující session po přerušení.

## Stav nalezený na začátku session 3 (ověřeno, ne převzato)
- Větev `audit/2026-09-30`, HEAD `a532d5c`, obsahuje `2e4d0c1` (`git branch --contains`). Pracovní strom čistý.
- `AUDIT_REPORT.md` má všech 7 částí, každou právě jednou (`grep -c '^## [1-7]\. '` = 7). Nedopsaný ani duplicitní blok z přerušeného zápisu v něm **není** — části 4–7 byly zapsány commitem `1a46993`.
- Uživatelův strom `tixly/`: 92 necommitnutých změn, HEAD `d4b43f4` — beze změny.
- Izolované prostředí (kontejnery `audit-*`, build `.next`) neexistuje; obrazy `postgis/postgis:17-3.5`, `edoburu/pgbouncer`, `axllent/mailpit` jsou lokálně.

## Fáze
| Fáze | Stav | Doložené výstupy |
|---|---|---|
| 1 — plán | HOTOVO | `audit/phase1_plan.md` |
| 2 — inventura kódu | HOTOVO (statická) | `audit/phase2_inventory.md` |
| 3 — kvalita testů | HOTOVO | `logs/01`–`07d`, `logs/09`, `logs/10a`,`10b`, `logs/11` |
| 4 — E2E | HOTOVO s výjimkami (níže) | `logs/02`,`03`,`17`, `logs/08`,`08b`, `logs/e2e_01`–`e2e_09` |
| 5 — bezpečnost | HOTOVO s výjimkami (níže) | `logs/12_r56_*`, `logs/e2e_06`–`e2e_08`, `logs/13`, `logs/14`, `logs/16*` |
| Report | 7 částí zapsáno; **kontrola proti logům v session 3 našla nepřesnosti** (níže) | `AUDIT_REPORT.md` |

## Nepřesnosti reportu nalezené porovnáním s logy (session 3) — k opravě
| # | Kde | Report tvrdí | Log říká |
|---|---|---|---|
| D1 | část 3 V8, část 5 | „čtení izolováno správně (L1, L2, L4, L5)" | `e2e_07.out`: L1 a L2 jsou FAIL — výhradně kvůli `promo_codes` (bez kontextu 2 řádky, v cizím kontextu 1 řádek); ostatní tabulky 0 |
| D2 | část 3 V8 | bez zmínky | `e2e_07.out` L7: 156 tabulek bez RLS; L6: `tixly_app` si sám nastaví `app.role=service` |
| D3 | část 3 K3a | „přirozený běh 06:49 UTC: 75 objednávek drželo 79 míst" | čísla 75/79 nejsou v žádném logu; doloženo je jen 500 + 42703 (`e2e_02.out` P15a, `15_app_server.log` ř. 37, 725, 754) |
| D4 | část 3 K3a, tabulka | bez zmínky | `e2e_04_*.out` X4: stejný cron vrací 200 `expiredCount:0`, když žádná prošlá objednávka není — padá až při první prošlé |
| D5 | část 3 V4 | „24× logScan failed (23 + 1)" | `15_app_server.log`: 25× (23× neplatné uuid, 2× NOT NULL) |
| D6 | část 4 | live sada „88 testů: 60 / 2 / 23" | 60+2+23 = 85; zbylé 3 testy (`rls-pool-pooler.live.test.ts`, R-56) se nespustily — soubor spadl v přípravě |
| D7 | část 4 | bez zmínky | `11_mutation_probe.log`: `seating/perf.test.ts` selhal u M1 a M2 (2 testy), u ostatních ne → nestabilní výkonnostní test |
| D8 | část 5 drift guard | bez zmínky | `08_drift_guard_baseline.log`: i bez umělého driftu „NOVY drift nad baseline (2) – CI FAIL" |
| D9 | tabulka + část 3 | bez zmínky | FAIL kontroly, které report nezmiňuje: `e2e_03` R1c, `e2e_04_*` X6, `e2e_04_owner` X7, `e2e_06` K8a |
| D10 | část 3 úvod | „postup v `audit/PROGRESS.md`" | postup v PROGRESS.md nebyl |
| D11 | část 1 ř. 2 | „50 souběžných webhooků" | `e2e_05.out` C2a: 30 webhooků + 20 přímých volání order-completed |

## Výjimky fází 4 a 5 (v reportu NEOVĚŘENO) — co z nich jde v session 3 dodělat
| Položka | Plán |
|---|---|
| Řetězec „demo" cest (resale/buy, upgrade, voucher confirm, subscription confirm) | dodělat za běhu |
| POS/pokladna, comps | dodělat za běhu |
| 2FA, pod-role, self-refund (po povolení), zrušení akce, uzávěrka prodeje, seznam objednávek kupce, auditní stopa refundu, obsah dokladu | dodělat za běhu |
| Offline fronta skeneru v prohlížeči (IndexedDB) | zkusit v prohlížeči; jinak NEOVĚŘENO |
| „Výpadek gate" (guestlist check-in, cross-pass) za běhu | **zůstává NEOVĚŘENO** (zadání: runtime test nepsat), jen statický důkaz |
| Produkce (role DB, env, nasazený commit), reálné brány | **zůstává NEOVĚŘENO** (audit se na produkci nepřipojuje; chybí sandbox klíče) |

## Hotovo v session 3 (vše doložené a commitnuté)
- [x] Prostředí postaveno znovu od nuly z migrací (`logs/18…session3`, 632 policies) + build (`logs/19`) + 2 app instance (`logs/20`,`20b`). REPRO v `audit/REPRO.md`.
- [x] Všech 9 původních E2E (01–09) reprodukováno se shodným vzorem PASS/FAIL (logy `s3_*`).
- [x] Demo cesty D1–D4 za běhu ověřeny (`10-demo-paths.mjs`, `s3_e2e_10`): upgrade/voucher/subscription-confirm/resale vystaví lístek/zůstatek bez platby; subscription checkout 500 (ON CONFLICT drift).
- [x] Provozní cesty (`11-operations.mjs`, `s3_e2e_11`): 2FA OVĚŘENO, comps OVĚŘENO, guestlist add+checkin OVĚŘENO, POS 500 pod `tixly_app` / 200 pod owner, self-refund 403 (RLS na refund_policies). Čistá role-sonda `s3_pos_selfrefund_role_diff.txt`.
- [x] Kontrolovaná sonda expire cronu (`s3_cron_expire_probe.txt`): 76 obj / 80 GA + 2 seats, 500 (42703), dispatcher maskuje 200.
- [x] Report opraven D1–D11 a doplněn o session-3 nálezy — po částech, commit po každé (parts 1–7).

## Trvale NEOVĚŘENO (mimo dosah / záměrně)
- Skutečný stav produkce (role DB, env, nasazený commit), reálné GoPay/ComGate — audit se na produkci nepřipojuje; Vercel API bylo nedostupné.
- „Výpadek gate" (cross-pass řetězec) za běhu — dle zadání runtime test nepsán; jen statický důkaz (drift guard GREEN).
- Offline fronta skeneru v prohlížeči (IndexedDB) — ověřen jen serverový manifest.
- Exporty nad rámec CSV, obsah faktur a DPH, výplaty — časový rozpočet.

## Poznámka k prostředí (konec session 3)
Dlouhoběžící servery (fake-gopay, `next start` :3100/:3101) byly zastaveny po vypršení background limitu — všechna měření byla do té doby hotová a commitnutá. Kontejnery `audit-*` a síť `audit-net` uklizeny na konci session.
