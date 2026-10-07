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
