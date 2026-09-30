# Tixly — nezávislý forenzní audit (2026-09-30)

**Předmět:** commit `d4b43f4` (větev `master` = `origin/master`), aplikace `nextjs-boilerplate/`.
**Neauditováno:** 92 necommitnutých změn v pracovním stromu `tixly/` (vč. migrací 472–478) — audit běžel v odděleném worktree `../tixly-audit` na větvi `audit/2026-09-30`, uživatelův strom zůstal nedotčen (`git status --short | wc -l` = 92 před i po).
**Prostředí:** izolovaný Postgres 17.5 + PostGIS v Dockeru (schéma postavené čistě z `migrations/` do `template0` DB), PgBouncer v transaction módu, Mailpit, simulátor GoPay API (`audit/tools/fake-gopay.mjs`), aplikace v produkčním režimu (`next build` + `next start`, `NODE_ENV=production`). **K produkční DB, platbám ani e-mailu se audit nepřipojil.** Produkční kód nebyl změněn; mutace běžely v dočasném worktree, který je smazán.
**Důkazy:** všechny logy v `audit/logs/`, skripty v `audit/e2e/`, `audit/tools/`, `audit/tests/`, `audit/live/`. Značení: `e2e_02:P15a` = soubor `audit/logs/e2e_02.out`, kontrola P15a.

> **Incident během auditu (moje chyba):** auditní artefakty (DB, build, obrazy ≈ 7–8 GB) dojely disk C: na 0 B. Spadl Docker Desktop včetně tvých běžících kontejnerů (`tixly-postgres`, `tixly-redis`, `tixly-kafka`, `tixly-mailhog`, `fm-minio`). Docker jsem restartoval, kontejnery naběhly zpět (`tixly-*` samy, `fm-minio` jsem spustil ručně). Jedno měření (první build, první běh mutační sondy) bylo tím znehodnoceno a bylo zopakováno. Na konci jsem své kontejnery, síť, DB, build a mutační worktree smazal; volno 24 GB.

---

## 1. Shrnutí

1. **Systém není nasaditelný pro reálný prodej.** Jádro nákupu je překvapivě pevné, ale kolem něj jsou díry, které stojí peníze nebo zamykají kapacitu.
2. **Co prokazatelně funguje:** registrace/login/role, izolace tenantů na aplikační vrstvě, tvorba akce, checkout → GoPay → webhook → vstupenka → e-mail, serverová cena, promo kódy, limity, sedadla s rezervací, sken u brány. 100 souběžných nákupů na 10 míst → přesně 10; 50 souběžných webhooků → přesně 10 vstupenek.
3. **K1 (kritické):** nepřihlášený útočník získá přes `POST /api/kiosk/order` platné placené vstupenky zdarma; projdou bránou.
4. **K2 (kritické):** refund vrací peníze jen v databázi — bránu nevolá nikdy. Zákazník peníze nedostane, systém tvrdí „refunded“.
5. **K3 (kritické):** cron expirace objednávek padá na 42703 → nezaplacené rezervace drží kapacitu navždy; nákup nemá rate-limit; zrušená platba místa nevrací. Kdokoli může akci „vyprodat“ bez placení.
6. **K4 (vysoké):** reset hesla vrací 500 (chybějící sloupec). Pod rolí `tixly_app`, kterou GO-LIVE vyžaduje, navíc nejde stáhnout PDF vstupenek ani stornovat objednávku.
7. **K5 (vysoké):** RLS na DB vrstvě dovolí komukoli přepsat publikovanou akci a ceny; `promo_codes` RLS nemá. R-56 je opravená jen podmíněně (bez opravy 40/60 requestů vidělo cizí objednávky).
8. **Testy uklidňují falešně:** coverage 3,3 % řádků; checkout, webhooky, refund, skener, auth a middleware mají 0 %. Mutační sonda: 3 ze 6, nezachyceny právě tři peněžní mutace.
9. **CI neexistuje:** workflow „CI“ neběžel nikdy, drift guard padá na chybějící secret, „RLS Gate“ hlásí success, ale je přeskočený, záloha DB padá 19× z 19.
10. **Neověřeno:** skutečný stav produkce (role, env, nasazený commit), reálné GoPay/ComGate, offline režim skeneru v prohlížeči.

---

## 2. Tabulka funkcí

Stavy: FUNGUJE-OVĚŘENO / ČÁSTEČNĚ / NEFUNGUJE / CHYBÍ / NEOVĚŘENO. Zdroj = `audit/phase1_plan.md` (ID C-xx, tam jsou přesné řádky dokumentů).

| Funkce | Zdroj v plánu | Stav | Důkaz | Poznámka |
|---|---|---|---|---|
| Registrace, login, bcrypt, duplicita, slabé heslo | C-01 `openapi.yaml:54-169` | FUNGUJE-OVĚŘENO | e2e_01:A1–A6 | hash v `identity.user_secrets` |
| Reset hesla | C-02 commit 84ca76e | NEFUNGUJE | e2e_04_app:X14, e2e_04_owner:X14; `15_app_server.log` „column "locale" does not exist“ | 500 pod oběma rolemi |
| Registrace pořadatele + schválení | C-03 `GO-LIVE-CHECKLIST.md:52-53` | FUNGUJE-OVĚŘENO | e2e_01:C1–C3 | KYC/ARES netestováno |
| 2FA | C-04 | NEOVĚŘENO | — | kód existuje jen pod `/api/admin/2fa/*` |
| Role platform admin / pořadatel / zákazník | C-05, C-06, C-08 | FUNGUJE-OVĚŘENO | e2e_01:B1, E1–E3 | |
| Odmítnutí přístupu k cizím datům (aplikační vrstva) | C-60 | FUNGUJE-OVĚŘENO | e2e_01:E4–E8; e2e_02:P7b,P7c; e2e_03:R0,R4,V2,V11; IDOR sweep | 1 výjimka viz S4 |
| Pod-role gate / box_office / finance | C-07 commit 069a48d | NEOVĚŘENO | — | `TESTING_MAP.md:99-105` samo říká, že guard neexistuje |
| Tvorba akce, typů, moderace → published | C-11, C-12, C-21 | FUNGUJE-OVĚŘENO | e2e_01:D2–D5; e2e_02:P0A,P0B | moderace v režimu mock |
| Místo (venue) | C-15 | ČÁSTEČNĚ | e2e_01:D1 | vytvoření OK; editor sálu netestován |
| Kapacita GA bez přeprodeje | C-17 `TESTING_MAP.md:297-301` | FUNGUJE-OVĚŘENO | e2e_02:P11,P16; e2e_05:C1a,C1b | |
| Sedadla: hold, souběh, nákup, uvolnění | C-16, C-18, C-19 | FUNGUJE-OVĚŘENO | e2e_09:Z0–Z11 (12/12) | sedadla seedována SQL |
| Expirace nezaplacené objednávky | C-20 `TESTING_MAP.md:281,287` | NEFUNGUJE | e2e_02:P15a; běh cronu 06:49 UTC (viz K3) | |
| Serverová autorita ceny | C-22 `TODO.md:76` | FUNGUJE-OVĚŘENO | e2e_02:P2b,P3,P3c | |
| Promo kódy vč. max_uses pod souběhem | C-25 | FUNGUJE-OVĚŘENO | e2e_02:P2b,P14; e2e_05:C3 | |
| Limit na osobu vč. souběhu | C-27 | FUNGUJE-OVĚŘENO | e2e_02:P12,P12b; e2e_05:C4 | |
| Validace košíku `/api/cart/validate` | INFERRED | NEFUNGUJE | e2e_02:P1 (500, `price_halire`) | routa nemá žádného volajícího |
| Checkout (GA, guest, přihlášený) | C-28 | FUNGUJE-OVĚŘENO | e2e_02:P2a–P2e, P10a | |
| Platba GoPay + webhook | C-30, C-33 | ČÁSTEČNĚ | e2e_02:P4,P5a,P8 | ověřeno proti simulátoru API, ne proti GoPay |
| ComGate a ostatní brány | C-31 | NEOVĚŘENO | — | chybí klíče/sandbox |
| Mock brána vypnutá v produkci | C-32 | ČÁSTEČNĚ | e2e_06:K2c PASS; K1 FAIL | mock-gopay blokován, ale kiosk a další „demo“ cesty guard nemají |
| Idempotence webhooku (3×) | C-33, C-35 | ČÁSTEČNĚ | e2e_02:P5b,P5c,P5e; e2e_05:C2a PASS; P5d, C2b FAIL | 1 vstupenka ✔; 3 záznamy `payment_paid` ✘ |
| Vystavení vstupenky | C-35 | FUNGUJE-OVĚŘENO | e2e_02:P5b; e2e_05:C2a | |
| Vstupenka zdarma (0 Kč) | C-36 `TODO.md:49` „HOTOVO“ | NEFUNGUJE | e2e_02:P13 | objednávka zůstane `pending`, 0 vstupenek |
| QR / TOTP | C-37 | ČÁSTEČNĚ | e2e_03:V6 (mismatch odmítnut) | výchozí politika `static_allowed` = stačí UUID vstupenky |
| PDF vstupenek | C-39 | ČÁSTEČNĚ | e2e_04_owner:X2 PASS; e2e_04_app:X2 FAIL | nefunguje pod `tixly_app` |
| E-mail s vstupenkami | C-40 | FUNGUJE-OVĚŘENO | e2e_02:P6,P10b; e2e_05:C2c (10/10, bez duplicit) | zachyceno v Mailpit |
| Admin refund (stav v DB) | C-44 | FUNGUJE-OVĚŘENO | e2e_03:R1a,R1d | |
| Refund peněz přes bránu | C-46 `TODO.md:28,110` | CHYBÍ | e2e_03:R1b; `fake-gopay.jsonl` bez volání `/refund` | viz K2 |
| Storno kupcem | C-45 commit 63b52ec | ČÁSTEČNĚ | e2e_04_owner:X3 PASS; e2e_04_app:X3 FAIL | pod `tixly_app` 500 (RLS `refund_requests`) |
| Self-refund kupcem | C-45 | NEOVĚŘENO | e2e_03:R2a (403 SELF_REFUND_DISABLED) | výchozí nastavení ho zakazuje |
| Sken platné / dvojitý / stornovaná | C-49 | FUNGUJE-OVĚŘENO | e2e_03:V3,V4,V7,V8 | 20 souběžných → 1× admitted |
| Sken vstupenky jiné akce | C-49 | NEFUNGUJE | e2e_03:V9b | API nemá `eventId` |
| Log skenů | C-51 | NEFUNGUJE | `15_app_server.log` „logScan failed“ 24×; `tickets.scan_logs` 0 řádků | viz V4 |
| Offline režim brány | C-50 | ČÁSTEČNĚ | e2e_03:V9a,V10,V11 (manifest) | klientská fronta v IndexedDB neověřena |
| Guestlist / comps / cross-pass | C-52 | NEOVĚŘENO | — | netestováno |
| Pokladna / POS | C-53 | NEOVĚŘENO | — | netestováno |
| Doklad kupci (PDF) | C-54 | ČÁSTEČNĚ | e2e_04_app:X7 (PDF 200) | obsah a DPH nekontrolovány |
| Faktury pořadatele | C-54 | ČÁSTEČNĚ | e2e_04:X11 | seznam 200; ISDOC netestován |
| Exporty a reporty | C-55 | ČÁSTEČNĚ | e2e_04:X8,X9,X10,X13 | CSV objednávek, sales report, export skenů; registr 198 reportů netestován |
| Výplaty | C-57 | ČÁSTEČNĚ | e2e_04:X12 | odpověď `source:"computed"`, id `mock-CZK-…`; `REMEDIATION.md:171-177` samo uvádí „výplaty nefungují“ |
| Izolace tenantů na DB vrstvě (RLS) | C-60 | ČÁSTEČNĚ | e2e_07:L1–L5; e2e_07b | čtení OK, zápis děravý (S1) |
| Rate limit loginu | C-61 | FUNGUJE-OVĚŘENO | e2e_06:K6a,K6b | |
| Rate limit nákupu | C-61 | CHYBÍ | e2e_05:C5 | 60/60 prošlo z jedné IP |
| R-56 (dva pooly) | C-63 | ČÁSTEČNĚ | `12_r56_*.log` | viz S2 |
| Migrace od nuly | INFERRED | ČÁSTEČNĚ | `02_migrate_from_zero.log` (24/24 OK) | jen s psql ≥ 17.6 nebo filtrem `\restrict` |
| Zrušení akce s hromadným refundem | C-14 | NEOVĚŘENO | — | dedikovaná routa nenalezena (fáze 1) |
| Uzávěrka prodeje po začátku akce | C-29 | NEOVĚŘENO | — | `TESTING_MAP.md:357` uvádí, že neexistuje |

---


## 3. Nálezy podle závažnosti

Reprodukce každého nálezu = spuštění uvedeného skriptu z `audit/e2e/` proti izolovanému prostředí (postup v `audit/PROGRESS.md`); ID kontroly odkazuje na řádek v `audit/logs/<soubor>.out`.

### KRITICKÉ

**K1 — Kiosková routa vystaví zaplacenou objednávku bez autentizace a bez platby**
- Popis: `POST /api/kiosk/order` nemá žádné ověření identity ani zařízení a objednávku rovnou označí jako zaplacenou. Platí i v produkčním režimu (`NODE_ENV=production`), kde je jinak mock brána správně vypnutá.
- Reprodukce: `audit/e2e/06-security.mjs`, kontroly K1, K1b.
- Důkaz: `e2e_06.out` K1 — HTTP 200, objednávka v DB `paid` / 100000 hal., 2 vstupenky `valid`, odpověď obsahuje TOTP tajemství vstupenek; K1b — skener vrátil `admitted`; K2c — mock brána ve stejném běhu vrací 403 `MOCK_DISABLED`.
- Soubory: `src/app/api/kiosk/order/route.ts`, `src/middleware.ts` (cesta není v chráněných prefixech).
- Příbuzné cesty stejné třídy, **za běhu NEOVĚŘENÉ** (jen čtení kódu, `audit/phase2_inventory.md` sekce C.1): `buyer/resale/buy`, POST `buyer/tickets/[ticketId]/upgrade`, `vouchers/holders/[paymentId]/confirm`, `subscriptions/holders/[paymentId]/confirm`. U posledních dvou je změřeno jen to, že bez přihlášení nevrací 401/403 (`e2e_06.out` K2a, K2b).

**K2 — Refund mění jen databázi, platební bránu nevolá**
- Popis: admin refund nastaví objednávku na `refunded`, zneplatní vstupenky a vrátí místa, ale peníze zákazníkovi neodejdou. Funkce `refundGopayPayment` a obdobné pro další brány nemají v kódu žádného volajícího.
- Reprodukce: `audit/e2e/03-refund-scan.mjs`, kontroly R1a, R1b.
- Důkaz: `e2e_03.out` R1a PASS (stav v DB); R1b FAIL — `refundCallsToGateway: 0`, platba u simulované brány stále `PAID`; `logs/fake-gopay.jsonl` neobsahuje žádné volání `/refund`. Komentář v `src/app/api/admin/orders/[orderId]/refund/route.ts:10-11` to sám uvádí („nevoláme reálný GoPay refund").
- Navazující: když refund ohlásí brána sama (webhook `REFUNDED`), objednávka přejde na `refunded`, ale vstupenka zůstane `valid` (`e2e_03.out` R5).
- Soubory: `src/app/api/admin/orders/[orderId]/refund/route.ts`, `bulk-refund/route.ts`, `admin/refund-requests/[id]/route.ts`, `buyer/orders/[orderId]/refund/route.ts`, `src/app/api/payments/gopay/webhook/route.ts`.

**K3 — Kapacitu lze trvale zablokovat bez placení (tři vady, které se sčítají)**
- a) Cron expirace nezaplacených objednávek padá na `column "event_seat_id" does not exist` (42703). Přirozený běh bez zásahu do dat v 06:49 UTC: 75 objednávek po expiraci drželo 79 míst, cron vrátil 500, po něm jich bylo stále 75. Dispatcher `/api/cron/dispatch` přitom odpověděl HTTP 200 se `status:500` uvnitř těla, takže plánovač vidí úspěch. Důkaz: `e2e_02.out` P15a; `15_app_server.log` řádek 37. Soubor: `src/app/api/internal/cron/expire-pending-orders/route.ts:76`. Cron je v `vercel.json:34` naplánován každých 5 minut.
- b) Nákup nemá rate-limit: 60 checkoutů z jedné IP během vteřin prošlo všech 60 (`e2e_05.out` C5). Guest checkout nevyžaduje účet.
- c) Platba zrušená u brány (`CANCELED`) objednávku zruší, ale místa do prodeje nevrátí: 3 místa ztracena (`e2e_06.out` K7). Soubor: `src/app/api/payments/gopay/webhook/route.ts` (větev CANCELED/TIMEOUTED mění jen status).
- Dopad: nezaplacené rezervace nikdy nezaniknou; kapacita akce se dá vyčerpat bez jediné platby.

### VYSOKÉ

**V1 — Reset hesla nefunguje**
- `POST /api/auth/forgot-password` → 500, `column "locale" does not exist` na `identity.users`. Pod oběma DB rolemi.
- Důkaz: `e2e_04_app.out` X14, `e2e_04_owner.out` X14; `15b_app_server_owner.log` řádek 7. Soubor: `src/app/api/auth/forgot-password/route.ts:94`.

**V2 — Pod rolí `tixly_app` nefunguje stažení PDF vstupenek ani storno kupcem**
- Rozdílový test stejných kroků pod `tixly_app` (RLS platí) a pod `neondb_owner`: PDF vstupenek 404 vs 200; storno zaplacené objednávky 500 (`new row violates row-level security policy for table "refund_requests"`) vs 200.
- Důkaz: `e2e_04_app.out` X2, X3 (FAIL) vs `e2e_04_owner.out` X2, X3 (PASS); `15_app_server.log` řádek 66.
- Význam: `GO-LIVE-CHECKLIST.md:142` požaduje přepnutí produkce na `tixly_app`. Po přepnutí tyto dvě cesty přestanou fungovat. Soubory: `src/app/api/buyer/orders/[orderId]/ticket-pdf/route.ts:30-66` (dotaz bez RLS kontextu), `buyer/orders/[orderId]/cancel/route.ts`.

**V3 — Skener nepozná vstupenku jiné akce téhož pořadatele**
- Schéma `POST /api/admin/scanner/validate` nemá `eventId`. Vstupenka akce A byla u „brány" akce A2 vpuštěna.
- Důkaz: `e2e_03.out` V9b (`admitted`, vstupenka `used`). Soubor: `src/app/api/admin/scanner/validate/route.ts:23-38`. Offline manifest je per-akce správně (V9a).

**V4 — Skeny se nezapisují do `scan_logs`**
- Sloupec `scanned_by_device_id` je `uuid NOT NULL`, API přijímá libovolný řetězec a webový skener `deviceId` neposílá vůbec. Chyba se jen vypíše do konzole.
- Důkaz: `15_app_server.log` — 24× `logScan failed` (23× neplatné uuid, 1× NOT NULL); `tickets.scan_logs` po 25+ skenech 0 řádků; `grep deviceId src/app/admin/scanner/page.tsx` = 0 výskytů. Soubor: `src/app/api/admin/scanner/validate/route.ts:434-457`.

**V5 — `next build` selže bez dosažitelné databáze**
- `/api/postal-fees` se při buildu prerenderuje a čte z DB. Bez DB: `Export encountered errors`, exit 1. S DB: exit 0.
- Důkaz: `10a_build_no_db_FAIL.log`, `10b_build_with_db.log`. CI job „Build" používá zástupné `DATABASE_URL` (`.github/workflows/ci.yml`), takže by padal.

**V6 — Vstupenka za 0 Kč se nikdy nevystaví**
- Checkout pro cenu 0 založí u brány platbu na částku 0; objednávka zůstane `pending`, vstupenka nevznikne. `TODO.md:49` uvádí „HOTOVO".
- Důkaz: `e2e_02.out` P13. Chování skutečné brány pro částku 0 je NEOVĚŘENO; výsledek (žádná vstupenka) na něm nezávisí.

**V7 — Platba přijatá po expiraci objednávky zůstane bez vstupenky i bez nápravy**
- Objednávka ve stavu `expired`, brána hlásí `PAID`: webhook odpoví `newStatus: paid`, ale objednávka zůstane `expired`, 0 vstupenek, žádný refund, žádná fronta k řešení. Jediná stopa je řádek v `payment_events`.
- Důkaz: `e2e_03.out` R6. (Stav `expired` byl nastaven SQL, protože cron z K3a nefunguje.)
