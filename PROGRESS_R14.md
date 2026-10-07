# PROGRESS — kolo 14 (spolehlivost pro den prodeje a den představení)

Větev `fix/round14-reliability-2026-10-07` z `7d180770`. Výstupy `logs/r14/`. Bez změn názvů, menu a vzhledu.
Prostředí: demo DB `r14demo` (`logs/r14/reset_demo.sh`), server `logs/r14/serve_r14.sh` (:3200), simulátor GoPay :3998,
Mailpit :58225; sada nad `r14a` z migrací (`logs/r14/serve_r14a.sh`).

## Krok 1 — skener bez internetu
- Spec `e2e/tests/golden-path-r14-offline-scanner.spec.ts` (body 1–6): RED 6/6 (`logs/r14/1_offline_red.txt`, 1c9188af) →
  GREEN 6/6 (`logs/r14/1_offline_green.txt`). Commity 0af475c2 (server, migrace 507), 95a52640 (klient, SW), a9077893 (testy,
  audit 03 V10, příručka).

## Krok 2 — nápor při spuštění prodeje
- k6 (nativní, 300 kupců / 60 s, sál 500 míst, PgBouncer pool 10 / 5), skripty `e2e/load/`, výsledky `logs/r14/2_load_tables.md`.
- Úzké hrdlo: CPU — každé PDF vstupenek ve webhooku znovu parsovalo TTF (~23 % CPU), transakce čekaly na aplikaci.
  Oprava 5c724bb5 (písmo jednou za proces). Řízené 503 + Retry-After při vyčerpaném poolu 9c364561. Nástroje ad89573e.
- Před → po (p95, pool 10): hold 2,08–2,81 s → 0,14–0,19 s; checkout 2,55–2,77 s → 0,40–0,58 s; 0 chyb, konzistence OK.

## Krok 3 — hlídání provozu
- Testy `tests/fix-r14-ops-monitoring.live.test.ts` (18) RED → GREEN, `tests/r14-sentry-scrub.test.ts` (5) RED → GREEN.
- Commity c5af1ea9 (testy), ca6b3421 (heartbeat, watchdog, souhrn, migrace 508), 7f1142dc (webhooky, e-mail, záloha),
  f09d4e38 (Sentry PII, sentry-check, inventura). Sentry ověřeno proti simulátoru (`logs/r14/3_sentry_envelopes.jsonl`).
- Nález: `forgemsg-provision` (hodinový cron) padá — tabulka public.forgemsg_credentials není v migracích (známý drift
  v baseline). Nově ho dispatcher hlásí jako selhání (502 + Sentry) a watchdog pošle e-mail.

## Krok 4 — testy jen pro Neon
- `tests/helpers/live-local-clone.ts`: bez NEON_API_KEY dělá `createLiveClone` lokální DB z migrací (šablona za otisk
  migrací, klon TEMPLATE, `exclude`/`migrations` od nuly), handlery pod tixly_app. `hasLiveDb = Neon || FIX_E2E=1`.
- 21 souborů převedeno; `logs/r14/4_neon_converted_run3.txt`: 20 souborů / 97 testů zelených, checkout-stress opt-in
  (RUN_AUDIT_REPRO=1) zelený zvlášť (`4_checkout_stress_optin.txt`). CI job Live je spouští sám (FIX_E2E=1).
- Co převod odhalil (vše vady testů, ne aplikace): seed bez DIČ / sazby DPH (C-54) → 422; admin-guest tvrdil už opravené
  vady T-WAITLIST-PROVIDER a T-BOXOFFICE-EXPIRES; cron-contract vynucoval chybu na neexistující audit.consent_log (42P01 →
  nic neměřil); payouts-processing RED „bez 468" byl GREEN, protože 497 vyčet přepisuje znovu → RED = DB před 468;
  checkout-stress sdílel klíč rate limitu `checkout:ip:unknown` v Redisu.
- Zjištění: pokladní prodej nepřepíše jméno existujícího účtu (trigger sync_user_name), i když politika je overwriteName.

## Závěrečná sada (po uvolnění paměti)
- Předchozí běh celé live sady (2 workery) i simulátor GoPay ukončil systém kvůli nedostatku paměti (69/107 souborů).
  fix-r8-theatre-reports opraven (totals + offlineDuplicates), 4/4 → 4467a517.
- Postup: před každým blokem ukončit vlastní procesy; live sada po 20 souborech, 1 worker, r14a z migrací;
  simulátor GoPay (`logs/r14/with_gopay.sh`) jen u souborů s checkout/GoPay/refund (seznamy `logs/r14/live/chunk_*`:
  n00–n03 bez simulátoru, g00–g01 se simulátorem); fix-r3-webhook-pool samostatně se simulátorem.
  Při ukončení kvůli paměti → blok na polovinu, pokračovat od místa přerušení.
- (a) live sada, r14a z migrací, 1 worker: n00 20/20 (83), n01 20/20 (49), n02 20/20 (73), n03 10/10 (37) bez simulátoru;
  g00 19/20 + checkout-stress opt-in přeskočen (163), g01 16/16 (77) se simulátorem; fix-r3-webhook-pool samostatně se
  simulátorem 2/2 → dřívější „fetch failed" = ukončený simulátor, ne vada. Celkem 106 souborů zelených + 1 opt-in,
  484 testů. Logy `logs/r14/live/`. Bez přerušení kvůli paměti.
- (b) `npm run build` OK (`logs/r14/9_app_build.txt`); build bez sítě v čistém klonu na 4467a517 OK — 0 síťových spojení
  (`9_build_no_network.console.txt`).
- (c) audity proti serveru nad čerstvou r14a (`logs/r14/run_audits.sh`, `9_audit_*.txt`): 01 26/0, 02 36/0, 03 23/0,
  04 14/0, 05 8/0, 06 21/0, 07 6/0, 07b všechny zápisy 0 řádků (shodné s kolem 13), 08 2/0 (166 rout × 3 aktéři),
  09 12/0, 10 7/0, 11 8/0, 12 5/0 (PASS/FAIL). Po bloku ručně ukončeny 4 zbylé procesy (next start na Windows
  nepřežije kill rodiče jen u bash) — u dalších bloků ukončení přes PowerShell.
- (d) turné nad čerstvou r14a 10/10 (`9_tour.txt`, screenshoty `logs/r14/tour`, logs/r8/tour vráceno); čerstvé r14demo:
  golden-path-r13-keep 10/10 (`9_keep.txt`), znovu čerstvé r14demo: spec offline skeneru 6/6 (`9_offline.txt`).
  Vizuálně: reporty termínu — řádek souhrnu „… · duplicitní offline vstupy 0", jinak beze změny (`tour/10a-reporty-termin.png`).
  Po každém bloku procesy ukončeny (PowerShell). Žádné ukončení kvůli paměti.
