# Kolo 14 — spolehlivost pro den prodeje a den představení

Větev `fix/round14-reliability-2026-10-07` z `7d180770` (integrate po kole 13) → PR do `integrate/2026-10-04`.
Jen opravy chyb, výkonu a spolehlivosti a neviditelné provozní funkce; názvy, menu a vzhled administrace, pokladny,
skeneru a webu beze změny. Výstupy `logs/r14/`, průběh `PROGRESS_R14.md`. Testy RED → GREEN, pod `tixly_app` s RLS.

## 1. Krok 1 — skener bez internetu (C-50)

Spec `e2e/tests/golden-path-r14-offline-scanner.spec.ts` (Chromium, `context.setOffline`): RED 6/6 (1c9188af,
`logs/r14/1_offline_red.txt`) → GREEN 6/6 (`1_offline_green.txt`), v závěrečné sadě znovu 6/6 (`9_offline.txt`).

| Bod | Výsledek | Commity |
|---|---|---|
| 1 | Seznam vstupenek termínu se stáhne do zařízení (stav platná/použitá/zrušená, kategorie, průkaz, místo, otisky TXP1/TXP2, TOTP kódy na 6 h; bez osobních údajů); skener ukazuje, kdy byl stažen. | 0af475c2, 95a52640 |
| 2 | Offline platí pravidla online: platná vpuštěna; použitá (online i offline na tomtéž zařízení) odmítnuta; stornovaná odmítnuta; jiný termín odmítnut; kategorie s průkazem hlášena; rotující QR (povinné TOTP) i tištěný TXP2 ověřen podpisem/otiskem. | 0af475c2, 95a52640 |
| 3 | Po obnovení sítě se offline odbavení odešlou (`POST /api/admin/scanner/offline-sync`, dávky po 50) idempotentně podle `client_scan_id` a zapíšou do `scan_logs` (migrace 507). | 0af475c2, 95a52640 |
| 4 | Dva skenery offline tutéž vstupenku → po synchronizaci druhé odbavení `duplicate`; počet v reportu termínu („duplicitní offline vstupy"). | 0af475c2, a9077893, 4467a517 |
| 5 | Zavření a znovuotevření prohlížeče offline: stránka skeneru se otevře z cache (service worker v3), seznam i neodeslaná odbavení přežijí v IndexedDB; stav sítě ověřuje dotaz na `/api/health`. | 95a52640 |
| 6 | Vstupenka stornovaná po stažení seznamu: online odmítnuta vždy; offline jen se seznamem staženým po stornu — v příručce pro vstup doplněno „stahovat těsně před otevřením dveří". | 0af475c2, a9077893 |

Audit 03 V10 upraven na nový tvar seznamu (stejná záruka: v seznamu nejsou osobní údaje ani tajemství).

## 2. Krok 2 — nápor při spuštění prodeje

k6 (nativní), 300 kupců během 60 s, sál 500 míst, přes PgBouncer (transaction). Kroky: stránka, plánek, hold, checkout,
platba v simulátoru, webhook (vystavení vstupenek + PDF + e-mail). Skripty `e2e/load/`, tabulky `logs/r14/2_load_tables.md`.

### Pool 10 — před a po opravě (2 běhy každý)

| krok | p50 před | p95 před | p99 před | p50 po | p95 po | p99 po | chybovost před / po |
|---|---|---|---|---|---|---|---|
| stránka | 326–361 ms | 0,82–1,18 s | 1,05–1,27 s | 66–105 ms | 289–441 ms | 523–556 ms | 0 % / 0 % |
| plánek | 113 ms | 0,72–1,22 s | 1,17–2,06 s | 18–29 ms | 103–163 ms | 170–277 ms | 0 % / 0 % |
| hold | 675–774 ms | **2,08–2,81 s** | 2,27–3,04 s | 34–60 ms | **136–189 ms** | 212–240 ms | 0 % / 0 % |
| checkout | 0,96–1,17 s | **2,55–2,77 s** | 3,50–3,51 s | 137–204 ms | **397–585 ms** | 464–928 ms | 0 % / 0 % |
| platba | 1 ms | 1–2 ms | 2–4 ms | 1 ms | 2 ms | 2–4 ms | 0 % / 0 % |
| webhook | 7,40–9,12 s | 9,68–16,25 s | 9,76–17,44 s | 0,66–1,33 s | 2,29–2,89 s | 2,46–3,07 s | 0 % / 0 % |

Cíl (bez přeprodeje, bez 5xx, p95 holdu a checkoutu < 1,5 s): před opravou **nesplněn** (p95 2,1–2,8 s), po opravě splněn.

### Úzké hrdlo a oprava

- Vzorkování `pg_stat_activity` během náporu: spojení „idle in transaction / ClientRead" — databáze čekala na aplikaci,
  ne naopak. Zvětšení přímého poolu na 10 situaci zhoršilo.
- CPU profil serveru: ~23 % vzorků v parsování TTF písma (fontkit) — každé PDF vstupenek ve webhooku znovu parsovalo písmo
  a blokovalo event loop, čímž zdržovalo i hold a checkout.
- **5c724bb5** — písmo se parsuje jednou za běh procesu a znovu se použije (`attachFont`, test `fix-r14-pdf-font-cache`).
- **9c364561** — při vyčerpaném poolu DB (čekání na spojení / spojení do PgBouncer nepřijato) odpoví plánek, hold, checkout
  míst a webhook GoPay řízeně `503 {error: BUSY}` + `Retry-After: 2` místo 500; jiné chyby se nemaskují
  (test `fix-r14-overload-503`, RED 8/9 → GREEN 9/9).
- Plánek (102 kB JSON) tvar beze změny — používá ho embed widget a mobilní aplikace; na Vercelu se komprimuje.

### Pool 5

| krok | p50 před | p95 před | p99 před | p50 po | p95 po | p99 po | chybovost před / po |
|---|---|---|---|---|---|---|---|
| stránka | 395 ms | 933 ms | 1,12 s | 86 ms | 309 ms | 462 ms | 0 % / 0 % |
| plánek | 402 ms | 1,35 s | 2,38 s | 28 ms | 157 ms | 254 ms | 0 % / 0 % |
| hold | 822 ms | 2,54 s | 2,72 s | 52 ms | 168 ms | 240 ms | 0 % / 0 % |
| checkout | 1,28 s | 3,11 s | 3,36 s | 197 ms | 467 ms | 681 ms | 0 % / 0 % |
| platba | 1 ms | 2 ms | 3 ms | 1 ms | 1 ms | 3 ms | 0 % / 0 % |
| webhook | 7,70 s | 15,24 s | 15,68 s | 854 ms | 1,53 s | 1,71 s | 0 % / 0 % |

Zátěžová varianta (pool 5, všech 300 kupců během 5 s, přímý pool 1): systém zpomalí (webhook p95 41,8 s, checkout
6,1 s), ale nespadne — 0 × 5xx, 0 chyb. Řízené 503 se v tomto běhu nespustilo (fronty se vešly do časových limitů);
cesta 503 + Retry-After je ověřena testem `fix-r14-overload-503` (9/9) a k6 ji umí opakovat.

### Konzistence po každém běhu

Ve všech 7 bězích: prodaná místa = zaplacené položky = vstupenky (500, v zátěžové variantě 423), místo prodané 2× 0,
osiřelé holdy 0, pending po expiraci 0 (`logs/r14/load/consistency_*.json`).

## 3. Krok 3 — hlídání provozu

Testy `tests/fix-r14-ops-monitoring.live.test.ts` (18) a `tests/r14-sentry-scrub.test.ts` (5) RED (c5af1ea9) → GREEN.

- **Heartbeat cronů** (ca6b3421): migrace 508 `monitoring.cron_heartbeats / ops_alerts / ops_events` (RLS servis + admin
  platformy). Dispatcher zapíše heartbeat po úspěchu; selhání jobu = 502 + Sentry (dřív 200 s chybou v těle).
  Intervaly z `vercel.json` + týdenní záloha DB.
- **Kontrolní job** `ops-watchdog` každých 15 min: cron, který neproběhl déle než 2× interval → e-mail na
  `PLATFORM_ADMIN_EMAIL`; zaplaceno u brány a bez vstupenek po 10 min; `refund_failed`.
- **Upozornění** (nejvýš 1 e-mail / 30 min na problém, `alertOps`): selhání webhooku kterékoli z 8 bran (5xx kromě
  řízeného 503, výjimka, chybějící konfigurace) (7f1142dc); zaplaceno bez vstupenek po 10 min; neodeslaný e-mail se
  vstupenkami; `refund_failed`; selhání zálohy DB (`POST /api/ops/backup-status` z workflow `db-backup`).
- **Denní souhrn** v 7:00 Europe/Prague (cron 5:00 a 6:00 UTC, odešle jen v 7. hodinu pražského času, 1× denně):
  prodeje a tržba po termínech, propadlé rezervace, neodeslané e-maily, nevyřízené refundy, chyby.
- **Sentry** (f09d4e38): maskování osobních údajů kupců v `beforeSend` (server, edge, prohlížeč) — e-maily, telefony,
  jména/adresy pod klíči, z `user` jen id; `POST /api/ops/sentry-check` pro ověření po nasazení; source mapy se po
  nahrání mažou. Ověřeno proti simulátoru Sentry: chyba z route i selhání cronu dorazí, 0 výskytů osobních údajů
  (`logs/r14/3_sentry_envelopes.jsonl`).
- Nález: `forgemsg-provision` (hodinový cron) padá — `public.forgemsg_credentials` není v migracích (známý drift baseline);
  nově ho dispatcher hlásí jako selhání a watchdog pošle e-mail.

**Nové proměnné** (zapsáno v `GO-LIVE-INVENTORY.md`): `PLATFORM_ADMIN_EMAIL` (příjemce upozornění a souhrnu),
`SENTRY_DSN` nově potřeba i při buildu (Vercel Build env), GitHub secrets `TIXLY_APP_URL` a `CRON_SECRET` pro hlášení
výsledku zálohy z workflow `db-backup`.

## 4. Krok 4 — testy „jen pro Neon"

`tests/helpers/live-local-clone.ts` (eca1afc3): bez `NEON_API_KEY` vytvoří `createLiveClone` lokální DB z migrací
(šablona za otisk migrací pod advisory zámkem, klon přes TEMPLATE; `exclude`/`migrations` od nuly), handlery pod
`tixly_app` s RLS, úklid `DROP … WITH (FORCE)`. `hasLiveDb = Neon klíč || FIX_E2E=1`, takže je CI job Live spouští sám.

**Převedeno (21):** admin-guest, auth-reset-password, booking-settlement, buyer-policies, checkout-guest, checkout-stress,
consent-purge, cron-contract, fan-bonus-r57, guest-user, live-fixture, mig455, party-split, payouts-processing,
payouts-select, public-routes, publish-events, red-green-470-471, red-green-488, rls-pool-pooler (proti lokálnímu
PgBouncer), wrapped-routes. Výsledek 20 souborů / 97 testů zelených (`logs/r14/4_neon_converted_run3.txt`).

**Zůstává jen pro Neon: nic.** `checkout-stress` zůstává opt-in (`RUN_AUDIT_REPRO=1`) — je to reprodukovač předexistující
vady audit/pool, ne regresní test; lokálně zelený 6× 200 (`4_checkout_stress_optin.txt`).

**Co převod odhalil** — vady testů, aplikace beze změny:
- seed bez DIČ promotéra a sazby DPH (C-54) → 422 (checkout-guest, party-split, admin-guest, checkout-stress);
- admin-guest tvrdil už opravené T-WAITLIST-PROVIDER a T-BOXOFFICE-EXPIRES → tvrdí funkční konverzi a pokladní prodej;
- cron-contract vynucoval chybu triggerem na neexistující `audit.consent_log` (42P01 = nic neměřil) → správná tabulka
  `compliance.cookie_consent_log`; route vrací `ok:false` + 500, jak má;
- payouts-processing: „vše kromě 468" je lokálně GREEN (497 výčet přepisuje znovu) → RED = DB před 468 (23514 → prošlo);
- checkout-stress: všechny běhy sdílely Redis klíč `checkout:ip:unknown` → vlastní IP na běh (limit 10/IP beze změny).

Zjištění bez změny: pokladní prodej nepřepíše jméno existujícího účtu (trigger `identity.sync_user_name` dopočítá jméno
z křestního jména a příjmení), i když route volá `overwriteName` — produktové rozhodnutí mimo kolo 14.

## 5. Změny v UI

| Kde | Změna | Proč |
|---|---|---|
| Reporty termínu (`admin/events/[id]/reporty`) | řádek souhrnu doplněn o „ · duplicitní offline vstupy N" | bod 4 zadání — počet duplicit po offline synchronizaci musí být v reportu; stejný řádek a styl, nic se neposunulo (`logs/r14/tour/10a-reporty-termin.png`) |
| Skener (offline výsledek) | nové hlášky „OFFLINE: lístek už byl použit.", „OFFLINE: lístek byl zrušen — NEVPOUŠTĚT.", „OFFLINE: kód nejde ověřit — stáhni seznam znovu." | bod 2 — offline rozlišuje použitou a zrušenou vstupenku a neověřitelný rotující kód; ve stylu stávajících hlášek „OFFLINE: …" (ostatní hlášky převzaty beze změny) |
| API plánku, holdu a checkoutu míst | při přetížení DB `503 {error: 'BUSY', message: 'Velký zájem — zkuste to prosím za chvíli znovu.'}` + Retry-After | krok 2 — řízené 503 místo 500; web (SeatPicker) zobrazí kód chyby na stávajícím místě jako u jiných chyb, text zprávy čte embed widget / aplikace |

Bez dalších změn rozvržení, názvů a menu. Service worker (`public/sw.js`) — jen strategie cache (neviditelné).

## 6. Závěrečná sada, CI, Vercel, PR

Lokálně (postup a logy v `PROGRESS_R14.md`, `logs/r14/9_*`, `logs/r14/live/`):

| Co | Výsledek |
|---|---|
| typecheck | 0 chyb (`4_tsc.txt`) |
| lint | bez nové chyby nad baseline (977 < 1008) |
| unit | 77 souborů, 712 testů zelených, 13 přeskočeno (`9_unit.txt`) |
| live | po částech po 20 souborech (paměť): 106 souborů, 484 testů zelených + checkout-stress opt-in; fix-r3-webhook-pool samostatně se simulátorem 2/2 |
| build | OK (`9_app_build.txt`) |
| build bez sítě | OK, 0 síťových spojení (čistý klon, `9_build_no_network.console.txt`) |
| audity | 01 26, 02 36, 03 23, 04 14, 05 8, 06 21, 07 6, 07b všechny zápisy 0 řádků, 08 2 (166 rout × 3 aktéři), 09 12, 10 7, 11 8, 12 5 PASS — 0 FAIL |
| turné divadla | 10/10 (`9_tour.txt`, `logs/r14/tour`) |
| golden-path-r13-keep | 10/10 (`9_keep.txt`) |
| offline skener | 6/6 (`9_offline.txt`) |

**PR #12** (`fix/round14-reliability-2026-10-07` @ 168be0ca → `integrate/2026-10-04`), CI:

| Job | Výsledek |
|---|---|
| Install · typecheck · lint · unit | pass (unit 712 passed, 13 skipped) |
| Live sada (Postgres z migrací, tixly_app) | pass — 106 souborů, 484 testů (+ checkout-stress opt-in); převedené testy kroku 4 v běhu |
| Build bez sítě (pojistka prerenderu) | pass |
| Schema drift | pass |
| RLS verify (DB z migrací vs snapshot) | pass — první běh selhal na prostředí runneru (port 55632 obsazený, kontejner se nespustil), znovu spuštěn bez změny kódu |
| Vercel – nextjs-boilerplate, Vercel – tixly | pass (Deployment has completed) |

Sloučeno `gh pr merge --merge` → **b023def1**; lokální `integrate/2026-10-04` fast-forward na b023def1.
PR #2 (do master) otevřený, nesloučený, 0 selhaných kontrol, kontroly po aktualizaci integrate běží.

Pozn.: push 168be0ca vracel 4× „Internal Server Error" z GitHubu (i u nové větve ze známého commitu), prošel na 5. pokus.
