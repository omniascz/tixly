# Tixly — nezávislý forenzní audit (2026-09-30)

**Předmět:** commit `d4b43f4` (větev `master` = `origin/master`), aplikace `nextjs-boilerplate/`.
**Neauditováno:** 92 necommitnutých změn v pracovním stromu `tixly/` (vč. migrací 472–478) — audit běžel v odděleném worktree `../tixly-audit` na větvi `audit/2026-09-30`, uživatelův strom zůstal nedotčen (`git status --short | wc -l` = 92 před i po).
**Prostředí:** izolovaný Postgres 17.5 + PostGIS v Dockeru (schéma postavené čistě z `migrations/` do `template0` DB), PgBouncer v transaction módu, Mailpit, simulátor GoPay API (`audit/tools/fake-gopay.mjs`), aplikace v produkčním režimu (`next build` + `next start`, `NODE_ENV=production`). **K produkční DB, platbám ani e-mailu se audit nepřipojil.** Produkční kód nebyl změněn; mutace běžely v dočasném worktree, který je smazán.
**Důkazy:** všechny logy v `audit/logs/`, skripty v `audit/e2e/`, `audit/tools/`, `audit/tests/`, `audit/live/`. Značení: `e2e_02:P15a` = soubor `audit/logs/e2e_02.out`, kontrola P15a. Postup reprodukce prostředí i kontrol je v `audit/REPRO.md`.

> **Navazující session (session 3):** prostředí bylo po session 1 smazáno, proto postaveno znovu od nuly z migrací (`logs/18_migrate_from_zero_session3.log`, 24/24 OK, 632 policies — shodné se session 1). Kvůli obsazeným portům jiným kontejnerem běží session 3 na jiných portech (viz `REPRO.md`); logy mají prefix `s3_`. **Všech 9 původních E2E skriptů (01–09) dalo shodný vzor PASS/FAIL jako session 1** — evidenční základ je reprodukovatelný. Session 3 navíc doplnila runtime ověření dříve neověřených cest (`s3_e2e_10`, `s3_e2e_11`, `s3_cron_expire_probe.txt`, `s3_pos_selfrefund_role_diff.txt`) a opravila nepřesnosti, které vznikly při přerušeném zápisu reportu (přehled oprav D1–D11 v `audit/PROGRESS.md`). Značení `s3_e2e_10:D1` = `audit/logs/s3_e2e_10.out`, kontrola D1.

> **Incident během auditu (moje chyba):** auditní artefakty (DB, build, obrazy ≈ 7–8 GB) dojely disk C: na 0 B. Spadl Docker Desktop včetně tvých běžících kontejnerů (`tixly-postgres`, `tixly-redis`, `tixly-kafka`, `tixly-mailhog`, `fm-minio`). Docker jsem restartoval, kontejnery naběhly zpět (`tixly-*` samy, `fm-minio` jsem spustil ručně). Jedno měření (první build, první běh mutační sondy) bylo tím znehodnoceno a bylo zopakováno. Na konci jsem své kontejnery, síť, DB, build a mutační worktree smazal; volno 24 GB.

---

## 1. Shrnutí

1. **Systém není nasaditelný pro reálný prodej.** Jádro nákupu je překvapivě pevné, ale kolem něj jsou díry, které stojí peníze nebo zamykají kapacitu.
2. **Co prokazatelně funguje:** registrace/login/role, 2FA (setup→verify→vynucení na loginu), izolace tenantů na aplikační vrstvě, tvorba akce, checkout → GoPay → webhook → vstupenka → e-mail, serverová cena, promo kódy, limity, sedadla s rezervací, sken u brány, comps, guestlist (přidání + check-in). 100 souběžných nákupů na 10 míst → přesně 10; 50 souběžných volání (30 webhooků + 20 přímých order-completed) na 10 objednávek → přesně 10 vstupenek.
3. **K1 (kritické):** nepřihlášený útočník získá placené vstupenky zdarma hned **pěti** cestami — `POST /api/kiosk/order`, resale/buy, ticket upgrade, voucher confirm, subscription holder confirm (za běhu ověřeno v session 3, `s3_e2e_10`); všechny vystaví `paid` objednávku / plnou vstupenku bez jediného volání platební brány a projdou bránou.
4. **K2 (kritické):** refund vrací peníze jen v databázi — bránu nevolá nikdy. Zákazník peníze nedostane, systém tvrdí „refunded“.
5. **K3 (kritické):** cron expirace objednávek padá na 42703 → nezaplacené rezervace drží kapacitu navždy; nákup nemá rate-limit; zrušená platba místa nevrací. Kdokoli může akci „vyprodat“ bez placení.
6. **V1, V2 (vysoké):** reset hesla vrací 500 (chybějící sloupec). Pod rolí `tixly_app`, kterou GO-LIVE vyžaduje, navíc nejde stáhnout PDF vstupenek, stornovat objednávku, prodat na pokladně (POS 500 na RLS) ani (jako kupující) self-refund (RLS skryje promotérovu politiku).
7. **V8, V9 (vysoké):** RLS na DB vrstvě dovolí komukoli přepsat publikovanou akci a ceny; `promo_codes` RLS nemá. R-56 je opravená jen podmíněně (bez opravy 40/60 requestů vidělo cizí objednávky).
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
| 2FA | C-04 | FUNGUJE-OVĚŘENO | s3_e2e_11:OP4a,OP4b | setup→verify (TOTP) zapne 2FA; login bez kódu 401 `TOTP_REQUIRED`, s platným kódem projde |
| Role platform admin / pořadatel / zákazník | C-05, C-06, C-08 | FUNGUJE-OVĚŘENO | e2e_01:B1, E1–E3 | |
| Odmítnutí přístupu k cizím datům (aplikační vrstva) | C-60 | FUNGUJE-OVĚŘENO | e2e_01:E4–E8; e2e_02:P7b,P7c; e2e_03:R0,R4,V2,V11; IDOR sweep | 1 výjimka viz S2 |
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
| „Demo" cesta: ticket upgrade bez platby | C.1#3 | NEFUNGUJE (zneužitelné) | s3_e2e_10:D1 | nepřihlášený (jen ownerEmail+ticketId) upgradne lístek, `paid` objednávka, 0 volání brány |
| „Demo" cesta: resale/buy bez platby | C.1#2 | NEFUNGUJE (zneužitelné) | s3_e2e_10:D4 | guest převezme listing → nový valid lístek + `paid` objednávka, listing `sold`, 0 volání brány |
| „Demo" cesta: voucher confirm bez auth | C.1#4 | NEFUNGUJE (zneužitelné) | s3_e2e_10:D2 | bez auth checkout+confirm → voucher `paid` s utratitelným zůstatkem, 0 volání brány |
| „Demo" cesta: subscription confirm bez auth | C.1#5 | NEFUNGUJE (zneužitelné) | s3_e2e_10:D3b | bez auth confirm (holder) → `active`/`paid` + vystavená vstupenka, 0 volání brány |
| Subscription checkout | C-56 | NEFUNGUJE | s3_e2e_10:D3a; `20_app_server_s3.log` | 500 „no unique or exclusion constraint matching the ON CONFLICT" (drift) |
| Idempotence webhooku (3×) | C-33, C-35 | ČÁSTEČNĚ | e2e_02:P5b,P5c,P5e; e2e_05:C2a PASS; P5d, C2b FAIL | 1 vstupenka ✔; 3 záznamy `payment_paid` ✘ |
| Vystavení vstupenky | C-35 | FUNGUJE-OVĚŘENO | e2e_02:P5b; e2e_05:C2a | |
| Vstupenka zdarma (0 Kč) | C-36 `TODO.md:49` „HOTOVO“ | NEFUNGUJE | e2e_02:P13 | objednávka zůstane `pending`, 0 vstupenek |
| QR / TOTP | C-37 | ČÁSTEČNĚ | e2e_03:V6 (mismatch odmítnut) | výchozí politika `static_allowed` = stačí UUID vstupenky |
| PDF vstupenek | C-39 | ČÁSTEČNĚ | e2e_04_owner:X2 PASS; e2e_04_app:X2 FAIL | nefunguje pod `tixly_app` |
| E-mail s vstupenkami | C-40 | FUNGUJE-OVĚŘENO | e2e_02:P6,P10b; e2e_05:C2c (10/10, bez duplicit) | zachyceno v Mailpit |
| Admin refund (stav v DB) | C-44 | FUNGUJE-OVĚŘENO | e2e_03:R1a,R1d | |
| Refund peněz přes bránu | C-46 `TODO.md:28,110` | CHYBÍ | e2e_03:R1b; `fake-gopay.jsonl` bez volání `/refund` | viz K2 |
| Storno kupcem | C-45 commit 63b52ec | ČÁSTEČNĚ | e2e_04_owner:X3 PASS; e2e_04_app:X3 FAIL | pod `tixly_app` 500 (RLS `refund_requests`) |
| Self-refund kupcem | C-45 | NEFUNGUJE (pod `tixly_app`) | s3_e2e_11:OP5a; `s3_pos_selfrefund_role_diff.txt` | i po povolení promotérem 403 — `refund_policies` má RLS na promotéra, kupující řádek nevidí; navíc by nevolal bránu (K2) |
| Sken platné / dvojitý / stornovaná | C-49 | FUNGUJE-OVĚŘENO | e2e_03:V3,V4,V7,V8 | 20 souběžných → 1× admitted |
| Sken vstupenky jiné akce | C-49 | NEFUNGUJE | e2e_03:V9b | API nemá `eventId` |
| Log skenů | C-51 | NEFUNGUJE | `15_app_server.log` „logScan failed“ 24×; `tickets.scan_logs` 0 řádků | viz V4 |
| Offline režim brány | C-50 | ČÁSTEČNĚ | e2e_03:V9a,V10,V11 (manifest) | klientská fronta v IndexedDB neověřena |
| Comps (volné vstupenky) | C-52 | FUNGUJE-OVĚŘENO | s3_e2e_11:OP2 | press comp → objednávka + platná vstupenka |
| Guestlist: přidání + check-in | C-52 | FUNGUJE-OVĚŘENO | s3_e2e_11:OP3a,OP3b | přidání založí záznam+lístek; check-in (token=e-mail) → `attended` |
| Cross-pass | C-52 | NEOVĚŘENO | — | netestováno (viz „výpadek gate" v části 5) |
| Pokladna / POS | C-53 | NEFUNGUJE (pod `tixly_app`) | s3_e2e_11:OP1; `s3_pos_selfrefund_role_diff.txt` | pod `tixly_app` 500 (RLS na `identity.users` při INSERT walk-in usera); pod `neondb_owner` 200 + 2 vstupenky — třída V2 |
| Doklad kupci (PDF) | C-54 | ČÁSTEČNĚ | e2e_04_app:X7 (PDF 200) | obsah a DPH nekontrolovány |
| Faktury pořadatele | C-54 | ČÁSTEČNĚ | e2e_04:X11 | seznam 200; ISDOC netestován |
| Exporty a reporty | C-55 | ČÁSTEČNĚ | e2e_04:X8,X9,X10,X13 | CSV objednávek, sales report, export skenů; registr 198 reportů netestován |
| Výplaty | C-57 | ČÁSTEČNĚ | e2e_04:X12 | odpověď `source:"computed"`, id `mock-CZK-…`; `REMEDIATION.md:171-177` samo uvádí „výplaty nefungují“ |
| Izolace tenantů na DB vrstvě (RLS) | C-60 | ČÁSTEČNĚ | e2e_07:L1–L5; e2e_07b | čtení OK, zápis děravý (V8) |
| Rate limit loginu | C-61 | FUNGUJE-OVĚŘENO | e2e_06:K6a,K6b | |
| Rate limit nákupu | C-61 | CHYBÍ | e2e_05:C5 | 60/60 prošlo z jedné IP |
| R-56 (dva pooly) | C-63 | ČÁSTEČNĚ | `12_r56_*.log` | viz V9 |
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
- Příbuzné cesty stejné třídy, v **session 3 za běhu OVĚŘENO** jako zneužitelné (`s3_e2e_10.out`, každá s `gopayCallsDelta = 0`):
  - **D1 upgrade** (`POST /api/buyer/tickets/[ticketId]/upgrade`): nepřihlášený s `ownerEmail`+`ticketId` upgradne lístek na dražší typ (VIP 1000 Kč), vznikne `paid` objednávka, lístek zdraží — bez platby.
  - **D4 resale** (`POST /api/buyer/resale/buy`): guest (jen `buyerEmail`) převezme aktivní listing → nový `valid` lístek + `paid` objednávka, listing `sold` — bez platby.
  - **D2 voucher** (`POST /api/vouchers/holders/[paymentId]/confirm`): bez auth checkout+confirm → voucher `payment_status=paid` s utratitelným zůstatkem 2000 Kč.
  - **D3b subscription** (`POST /api/subscriptions/holders/[paymentId]/confirm`): bez auth confirm (holder seedován, protože oficiální checkout 500-uje, viz S8) → holder `active`/`paid` + vystavená vstupenka.
- Souhrn: **pět** neautentizovaných/neplacených cest k platné vstupence (kiosk + tyto čtyři). Řetězce jsou nyní doloženy až do DB, ne jen čtením kódu.

**K2 — Refund mění jen databázi, platební bránu nevolá**
- Popis: admin refund nastaví objednávku na `refunded`, zneplatní vstupenky a vrátí místa, ale peníze zákazníkovi neodejdou. Funkce `refundGopayPayment` a obdobné pro další brány nemají v kódu žádného volajícího.
- Reprodukce: `audit/e2e/03-refund-scan.mjs`, kontroly R1a, R1b.
- Důkaz: `e2e_03.out` R1a PASS (stav v DB); R1b FAIL — `refundCallsToGateway: 0`, platba u simulované brány stále `PAID`; `logs/fake-gopay.jsonl` neobsahuje žádné volání `/refund`. Komentář v `src/app/api/admin/orders/[orderId]/refund/route.ts:10-11` to sám uvádí („nevoláme reálný GoPay refund").
- Navazující: když refund ohlásí brána sama (webhook `REFUNDED`), objednávka přejde na `refunded`, ale vstupenka zůstane `valid` (`e2e_03.out` R5).
- Soubory: `src/app/api/admin/orders/[orderId]/refund/route.ts`, `bulk-refund/route.ts`, `admin/refund-requests/[id]/route.ts`, `buyer/orders/[orderId]/refund/route.ts`, `src/app/api/payments/gopay/webhook/route.ts`.

**K3 — Kapacitu lze trvale zablokovat bez placení (tři vady, které se sčítají)**
- a) Cron expirace nezaplacených objednávek padá na `column "event_seat_id" does not exist` (42703). Kontrolovaná sonda (session 3, `s3_cron_expire_probe.txt`): 76 objednávek po expiraci drželo 80 GA vstupenek + 2 sedadla; `POST /api/internal/cron/expire-pending-orders` → HTTP 500, po něm stále 76 (nic neuvolněno). Dispatcher `GET /api/cron/dispatch?job=expire-pending-orders` přitom vrátil **HTTP 200** s tělem `{"job":…,"status":500,"result":{…event_seat_id…}}` — vnitřní 500 se do HTTP stavu nepropíše, takže plánovač vidí úspěch (`src/app/api/cron/dispatch/route.ts:113-117`). Původní doklad i z běhu v session 1: `e2e_02.out` P15a; `15_app_server.log` řádek 37. Soubor: `src/app/api/internal/cron/expire-pending-orders/route.ts:76`. Cron je v `vercel.json:34` naplánován každých 5 minut. (Pozn.: `04_*.out` X4 ukazuje, že při **žádné** prošlé objednávce cron vrátí 200 `expiredCount:0` — 500 nastává až s první prošlou objednávkou.)
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
- **Session 3 rozšířila tuto třídu o další dvě cesty** (stejná role-differenční sonda, `s3_pos_selfrefund_role_diff.txt`):
  - **POS / pokladna** (`POST /api/admin/pos/sale`): pod `tixly_app` 500 — `new row violates row-level security policy for table "users"` (INSERT walk-in kupce do `identity.users`); pod `neondb_owner` 200 + 2 platné vstupenky. Doklad: `s3_e2e_11:OP1` (tixly_app 500), čistá sonda (owner 200). Soubor: `src/app/api/admin/pos/sale/route.ts:157`.
  - **Self-refund kupcem** (`POST /api/buyer/orders/[orderId]/refund`): i po povolení promotérem (`platform.refund_policies.allow_customer_self_refund=true`, řádek v DB ověřen) vrací 403 `SELF_REFUND_DISABLED`. Příčina: `refund_policies` má RLS `promoter_id = app_current_promoter_id()` (`pg_policies: p_refund_policies_tenant`); refund běží v kontextu kupujícího (bez promoter membership), `LEFT JOIN refund_policies` vrátí NULL → `allow_self=false`. Kupující tak politiku promotéra nikdy neuvidí. Doklad: `s3_e2e_11:OP5a`; route `src/app/api/buyer/orders/[orderId]/refund/route.ts:99-111`.

**V3 — Skener nepozná vstupenku jiné akce téhož pořadatele**
- Schéma `POST /api/admin/scanner/validate` nemá `eventId`. Vstupenka akce A byla u „brány" akce A2 vpuštěna.
- Důkaz: `e2e_03.out` V9b (`admitted`, vstupenka `used`). Soubor: `src/app/api/admin/scanner/validate/route.ts:23-38`. Offline manifest je per-akce správně (V9a).

**V4 — Skeny se nezapisují do `scan_logs`**
- Sloupec `scanned_by_device_id` je `uuid NOT NULL`, API přijímá libovolný řetězec a webový skener `deviceId` neposílá vůbec. Chyba se jen vypíše do konzole.
- Důkaz: `15_app_server.log` — 25× `logScan failed` (23× neplatné uuid, 2× `NOT NULL` na `scanned_by_device_id`); `tickets.scan_logs` po 25+ skenech 0 řádků; `grep deviceId src/app/admin/scanner/page.tsx` = 0 výskytů. Soubor: `src/app/api/admin/scanner/validate/route.ts:434-457`.

**V5 — `next build` selže bez dosažitelné databáze**
- `/api/postal-fees` se při buildu prerenderuje a čte z DB. Bez DB: `Export encountered errors`, exit 1. S DB: exit 0.
- Důkaz: `10a_build_no_db_FAIL.log`, `10b_build_with_db.log`. CI job „Build" používá zástupné `DATABASE_URL` (`.github/workflows/ci.yml`), takže by padal.

**V6 — Vstupenka za 0 Kč se nikdy nevystaví**
- Checkout pro cenu 0 založí u brány platbu na částku 0; objednávka zůstane `pending`, vstupenka nevznikne. `TODO.md:49` uvádí „HOTOVO".
- Důkaz: `e2e_02.out` P13. Chování skutečné brány pro částku 0 je NEOVĚŘENO; výsledek (žádná vstupenka) na něm nezávisí.

**V7 — Platba přijatá po expiraci objednávky zůstane bez vstupenky i bez nápravy**
- Objednávka ve stavu `expired`, brána hlásí `PAID`: webhook odpoví `newStatus: paid`, ale objednávka zůstane `expired`, 0 vstupenek, žádný refund, žádná fronta k řešení. Jediná stopa je řádek v `payment_events`.
- Důkaz: `e2e_03.out` R6. (Stav `expired` byl nastaven SQL, protože cron z K3a nefunguje.)

**V8 — RLS na DB vrstvě nebrání zápisu do publikovaných akcí; `promo_codes` RLS nemá**
- Policies `p_events_promoter_scope` (`catalog.events`) a `p_ticket_types_event_scope` (`catalog.ticket_types`) jsou `FOR ALL` s větví `status = 'published'` a bez `WITH CHECK`. Větev určená pro veřejné čtení tím povoluje i UPDATE. `marketing.promo_codes` má RLS vypnuté.
- Reprodukce: `audit/e2e/07-rls-direct.mjs` (L2, L3), `audit/e2e/07b-rls-published-write.mjs` (vše v transakci s ROLLBACK).
- Důkaz: `e2e_07b.out` — role `tixly_app` bez jakéhokoli kontextu: změna názvu publikované akce 1 řádek, změna cen 7 typů vstupenek, smazání 2 promo kódů. `e2e_07.out` L3 — totéž v kontextu cizího pořadatele. Čtení objednávek, vstupenek, uživatelů a hashů hesel izolováno správně (L1, L2, L4, L5).
- Zmírnění: aplikační vrstva tyto zápisy odmítá (`e2e_01.out` E5, E6). RLS je druhá vrstva a v tomto bodě nedrží.

**V9 — R-56 (únik kontextu v poolu): oprava funguje, ale jen když se podaří odvodit přímé připojení**
- Test: 60 souběžných requestů 30 uživatelů přes skutečný `rls-pool.ts`, role `tixly_app`, PgBouncer v transaction módu. Důkaz: `12_r56_direct.log`, `12_r56_fixed.log`, `12_r56_nodirect.log`.

| Konfigurace | `connect()` cesta | `query()` cesta |
|---|---|---|
| přímé připojení | 0/60 chyb | 0/60 |
| pooler + `DATABASE_URL_DIRECT` (oprava) | 0/60 | 0/60 |
| pooler, přímé URL neodvozeno | 40/60 cizí kontext, 9/60 prázdný; 40 requestů vidělo cizí objednávky | 0/60 |

- Přímé URL se odvozuje regexem z hostu obsahujícího `-pooler.` (`src/lib/db/rls-pool.ts:62-71`). Pro jiný tvar hostu nebo jiný pooler se oprava tiše neuplatní. Kontrola `applyGucs` to nezachytí (nastavení i zpětné čtení proběhnou v jednom dotazu na tomtéž backendu).
- Stav na produkci (tvar `DATABASE_URL`, nastavení `DATABASE_URL_DIRECT`): NEOVĚŘENO.

### STŘEDNÍ

**S1 — Jedna platba vytvoří tři záznamy `payment_paid`**
- Každé doručení webhooku zapíše nový řádek do `orders.payment_events`, i když objednávka už zaplacená je. Důkaz: `e2e_02.out` P5d (3 řádky), `e2e_05.out` C2b (10 z 10 objednávek po 3 řádcích). Vstupenky ani e-maily se neduplikují. Dopad na účetní přehledy a exporty závisí na tom, co z tabulky čte — nezkoumáno.

**S2 — `GET /api/buyer/tickets/[ticketId]/upgrade` vrací stav vstupenky komukoli**
- IDOR sweep: 153 GET rout s ID v URL × 3 cizí aktéři (jiný pořadatel, jiný kupec, nepřihlášený). Jediný únik: tato routa vrací stav a typ vstupenky i nepřihlášenému, pokud zná UUID vstupenky. Důkaz: `e2e_08_idor_findings.json` (`leaks`). 55 rout sweep netestoval (parametr nešlo dosadit), POST/PATCH/DELETE routy sweep nepokrývá.
- Dvě routy vracejí cizímu aktérovi 500 místo 4xx: `buyer/orders/[orderId]/calendar.ics`, `public/events/[id]/kiosk`.

**S3 — Refresh token (7 dní) funguje jako access token na `/api/buyer/*`**
- Middleware neověřuje typ tokenu. Důkaz: `e2e_06.out` K4d (200 s refresh tokenem; access token má TTL 900 s). Soubor: `src/middleware.ts:31-42`.

**S4 — Neautentizovaný cron přepisující ceny**
- `POST /api/internal/cron/recompute-dynamic-pricing` bez tokenu → 200. Důkaz: `e2e_06.out` K3a. Ostatní testované interní routy token vyžadují (K3b, K3c, K3d).

**S5 — Kód psaný proti jinému schématu, než jaké staví migrace (59 míst)**
- Drift guard proti schématu z migrací: 2347 statických dotazů, 59 míst s chybějícím sloupcem/tabulkou. Důkaz: `08_drift_guard_baseline.log`. Za běhu potvrzeno: `expire-pending-orders` (K3a), `forgot-password` (V1), `cart/validate` (`e2e_02.out` P1; routa nemá volajícího), `my/orders/[id]/upgrade-options` (`09_live_suite.log`, 500).
- Ne každé místo je vada za běhu: `src/lib/pricing/resolve-price.ts:123` je chráněno kontrolou existence tabulky. Ostatních ~54 míst za běhu neověřeno.

**S6 — Migrace od nuly vyžadují psql ≥ 17.6 nebo filtr**
- `000_baseline_20260730.sql` obsahuje meta-příkaz `\restrict`; s psql 17.5 soubor neprojde vůbec. Po odfiltrování (stejně jako `scripts/baseline-clone.mjs`) projde 24/24. Důkaz: `02_migrate_from_zero.log`, `17_migrate_from_zero_session2.log`.

**S7 — Závislosti: 52 zranitelností (2 critical, 22 high)**
- Důkaz: `14_npm_audit.json`. Critical: `next` (14.2.35) a `vitest`. High v produkčních závislostech mimo jiné `axios`, `nodemailer`, `undici`, `ws`, `form-data`. Zneužitelnost jednotlivých hlášení v tomto nasazení neposuzována.

**S8 — Oficiální checkout předplatného padá (drift `ON CONFLICT`)**
- `POST /api/subscriptions/checkout` → HTTP 500 `INTERNAL`: `there is no unique or exclusion constraint matching the ON CONFLICT specification`. Kód se opírá o constraint, který schéma z migrací nemá. Předplatné tedy nelze koupit oficiální cestou (samotný neautentizovaný `…/holders/[paymentId]/confirm` přitom funguje — viz K1/D3b).
- Důkaz: `s3_e2e_10.out` D3a; `20_app_server_s3.log` (`[POST /api/subscriptions/checkout] error … ON CONFLICT`). Řadím jako STŘEDNÍ (funkce mimo provoz, ne peněžní únik).

**S9 — Kontroly, které report v části 3 nejmenoval jmenovitě (doplněno session 3, doloženo v session 1 i 3)**
- `e2e_03:R1c` — admin refund **nemá auditní stopu**: zápis do `audit.audit_log` selže na `column "entity_id" does not exist`, `refund_requests` 0 řádků; jediná stopa je `payment_events`.
- `e2e_04_app:X6` a `e2e_04_owner:X6` — `GET /api/buyer/orders` (seznam objednávek kupce) vrací **404** pod oběma rolemi (stránka/route chybí).
- `e2e_04_owner:X7` — doklad/faktura kupci pod `neondb_owner` vrací 404 (`NOT_FOUND`), zatímco pod `tixly_app` 200 — obrácený role-rozdíl než V2 (pozorování, ne peněžní dopad).
- `e2e_06:K8a` — SQLi řetězec v ID (`/api/events/{id}/ticket-types`) vrací **200 `{"ticketTypes":[]}`** místo 4xx; není injekce (parametrizováno), ale vstup není odmítnut. `K8c` (nevalidní JSON → 4xx) a `K8b` (XSS v e-mailu escapován) drží.

### NÍZKÉ

- **N1 — CSRF stojí jen na `SameSite=Lax`.** Server `Origin` neověřuje: stavový POST s cizím `Origin` prošel (`e2e_06.out` K5). Cookies jsou `HttpOnly; Secure; SameSite=lax` (K4e).
- **N2 — Lint a formát:** ESLint 1030 errors / 451 warnings, Prettier 1419 neformátovaných souborů (`05_eslint.log`, `06_prettier.log`). TypeScript 0 chyb (`04_tsc.log`).
- **N3 — 6 unit testů trvale červených** v `src/app/api/subscriptions/checkout/route.test.ts` (`07_vitest.log`).
- **N4 — Test `cron-contract > consent-log-purge` nemůže zachytit, co tvrdí:** vyrábí selhání na tabulce `audit.consent_log`, která ve schématu z migrací neexistuje; routa pracuje s `compliance.cookie_consent_log` (`09_live_suite.log`).
- **N5 — Self-test drift guardu je zastaralý:** očekává drift ve dvou souborech, které už opravené jsou → self-test končí „NEPROSEL" (`08_drift_guard_baseline.log`).
- **N6 — QR kód se kupci ve výchozím nastavení neukáže před začátkem akce** (`qr_reveal_minutes_before` = 0; `e2e_02.out` P7a: `revealed:false`). Může jít o záměr; uvádím jako pozorování.

## 4. Stav testů

### Čísla
| Položka | Výsledek | Důkaz |
|---|---|---|
| `npm ci` | OK | `01_npm_ci.log` |
| `tsc --noEmit` | 0 chyb | `04_tsc.log` |
| ESLint | 1030 errors, 451 warnings, exit 1 | `05_eslint.log` |
| Prettier | 1419 souborů neformátovaných, exit 1 | `06_prettier.log` |
| `next build` bez DB / s dosažitelnou DB | exit 1 / exit 0 | `10a_build_no_db_FAIL.log`, `10b_build_with_db.log` |
| Unit/komponentové (vitest, jsdom) | 518 testů: 508 prošlo, 6 selhalo, 4 `it.skip` | `07_vitest.json`, `07_vitest.log` |
| Live sada proti izolované DB (místo klonu produkce) | 88 testů deklarováno: 60 prošlo + 2 selhaly + 23 skip = **85 spuštěno**; zbylé **3 se nespustily** (soubor `rls-pool-pooler.live.test.ts` spadl v přípravě, R-56) | `09_live_suite.log` (14 „failed" test-souborů = převážně chyba v `beforeAll`, ne aserce) |
| **Coverage řádků** | **3,3 %** (7209 / 218215); 1302 z 1365 souborů 0 % | `07b_vitest_coverage.log`, `07d_coverage_critical.txt` |

Kritické moduly s **0 %** pokrytí: `checkout/route.ts` (0/2440), `internal/order-completed` (0/975), `demo-issuer.ts` (0/265), `admin/scanner/validate` (0/470), `middleware.ts` (0/320), všechny refund/cancel routy, `auth/{login,register,forgot-password,reset-password,refresh}`, `cart/validate`, `kiosk/order`, `email/mailer.ts`. Slušně pokryté: `guest-user.ts` 100 %, `totp/verify.ts` 100 %, `resolve-price.ts` 95 %, `rls-pool.ts` 78 %.

### Zpochybnění testů
- **Skip/only/todo:** 23 markerů. Podstatné je `describe.skipIf(!NEON_API_KEY)` na celé live sadě — bez klíče (běžný stav CI, viz část 5) se DB testy tiše přeskočí a sada je přesto zelená.
- **Testy mockující testovanou věc:** `subscriptions/checkout/route.test.ts` mockuje `pg` (`vi.mock('pg')`) → netestuje reálné SQL (proto ho nechytil ani schema drift). Ostatní DB testy jsou vedeny jako live proti reálné DB, ne mockem.
- **Falešně uklidňující:** live sada `skipIf(!NEON_API_KEY)` v CI bez klíče = 0 spuštěných DB testů, přesto zeleno; N4 (kontrakt cronu proti neexistující tabulce); N5 (self-test drift guardu očekává už opravený drift).

### Mutační sonda
6 kritických funkcí, změna vždy vrácena `git checkout` (strom po každé mutaci čistý) — `11_mutation_probe.log`:

| Mutace | Zachyceno? | Poznámka |
|---|---|---|
| M1 TOTP okno ±1 → ±100 | ANO | `totp/verify.test.ts` zčervenal |
| M2 mock-guard vždy povolen | **NE** | žádný test |
| M3 GoPay webhook: vypnutá kontrola částky | **NE** | žádný test |
| M4 checkout: přeprodej (podmínka `remaining_qty >= qty` pryč) | **NE** | žádný test |
| M5 issuer: bez locku/idempotence, náhodný `ticket_seq` | ANO | `live-fixture` idempotence test |
| M6 resolve-price: cena −1 haléř | ANO | 8 testů `resolve-price.test.ts` |

Tři nezachycené mutace jsou přesně ty peněžní/kapacitní. Jejich reálný dopad jsem ověřil E2E (K1/K2, P8 podplacení, C1 přeprodej) — vady by prošly do produkce bez povšimnutí testovou sadou.

> **Poznámka k mutační sondě (session 3):** u M1 a M2 „zčervenal" kromě cíleného testu i `src/lib/seating/perf.test.ts` (výkonnostní test na 100k sedadel, práh 2000 ms) — u ostatních mutací ne. Jde o **nestabilní (flaky) výkonnostní test závislý na zátěži stroje**, ne o skutečné zachycení mutace; verdikt „zachyceno/ne" v tabulce se opírá výhradně o cílené testy (`totp/verify.test.ts` pro M1). `11_mutation_probe.log` — každá mutace vrácena `git checkout`, strom po ní čistý (`revertedClean`).

## 5. Stav dříve známých problémů

- **RLS / role aplikace:** Pod `tixly_app` (NOBYPASSRLS) je **čtení citlivých dat izolováno** — objednávky, vstupenky, uživatelé, hashe hesel a platby jsou při přístupu bez kontextu i v cizím tenant-kontextu 0 řádků (`e2e_07.out` L1 `seenAsTixlyApp` orders/tickets/users/user_secrets/payment_events = 0; L4, L5). **Upřesnění (session 3):** kontroly L1 a L2 jsou v logu přesto `FAIL` — výhradně kvůli `marketing.promo_codes`, které RLS **nemá** (L1 vidí 2 promo kódy bez jakéhokoli kontextu, L2 cizí promotér 1). Kromě toho L7 vypisuje **156 tabulek úplně bez RLS** čitelných rolí `tixly_app` bez ohledu na tenanta (mezi nimi podle názvu citlivé `affiliate.payouts`, `ambassador.payouts`, `b2b.webhook_subscriptions`, `conference.sessions`, `orders.foyer_orders`…), a L6 je vlastnost návrhu: kdokoli s připojením `tixly_app` si sám `set_config('app.role','service')` zapne plný přístup (RLS chrání před chybou v kódu, ne před SQL injection / přímým připojením). **Zápis** není izolován — publikované akce a ceny přepíše kdokoli (V8). `FORCE ROW LEVEL SECURITY` = 0 tabulek → jakmile aplikace poběží jako vlastník tabulek (`neondb_owner`, `rolbypassrls=true`), RLS se **celé obchází**, což `GO-LIVE-CHECKLIST.md:142` i `REMEDIATION.md:34-42` uvádějí jako aktuální produkční stav. Tvrzení „všech ~596 policies neúčinných" je **pro roli `neondb_owner` platné** (potvrzeno atributem role, `e2e_07.out` L8), pro `tixly_app` neplatné u čtení citlivých tabulek, ale s dírami (promo_codes + 156 tabulek bez RLS) a s neizolovaným zápisem. Skutečná produkční role: NEOVĚŘENO.
- **R-56 (únik kontextu v poolu):** oprava funguje pro přímé připojení i pro direct odvozený z pooleru; selhává, když se direct neodvodí (V9). Regrese **opravena podmíněně**.
- **P1 „tichý refund" (HANDOFF #1):** storno kupcem už tiše neuspěje — pod `neondb_owner` vrátí korektní stav i `refund_request` (`e2e_04_owner.out` X3). Pod `tixly_app` skončí 500 (V2). **Opraveno pro dnešní roli, rozbité pro cílovou.**
- **P1 „výpadek gate" (HANDOFF #2 cross-pass, #3 guestlist):** drift guard i jeho self-test ukazují dotčené routy jako čisté (`08_drift_guard_baseline.log`, GREEN). Za běhu NEOVĚŘENO (chybí seed cross-pass/guestlist řetězce).
- **P1 „race dvojitého vystavení" (HANDOFF #4):** neopakuje se. 50 souběžných volání (30 webhooků + 20 přímých order-completed) na 10 objednávek → přesně 10 vstupenek, 1 na objednávku (`e2e_05.out` C2a). Mutační sonda M5 potvrzuje, že to drží ochrana v kódu. **Opraveno.**
- **Guest-create helper „na 1 místě":** **neplatí.** 23 míst `INSERT INTO identity.users`; 1 v helperu `lib/identity/guest-user.ts:131`, 4 reálné účty (register, register-promoter, team/accept, OAuth), zbylých 18 zakládá guesty/walk-iny mimo helper (`audit/phase2_inventory.md` sekce D, ověřeno grepem). Helper sám je 100 % pokrytý a funkční, ale jednotný není.
- **Drift guard:** proti izolované DB funguje (59 driftů, `08_drift_guard_baseline.log`). Umělý drift (přejmenování `orders.paid_at`) → guard nahlásil 52 nových míst nad baseline a skončil exitem 1 (`08b_drift_guard_artificial.log`). **Guard reálně selže při driftu.** Upřesnění (session 3): už **základní** běh bez umělého driftu hlásí `NOVY drift nad baseline (2) - CI FAIL` (`seat-upgrade-notify` `zone_name`, `reviews` `reviewer_name`) — tj. proti committnutému baseline `162 míst / 137 klíčů (2026-07-04)` je aktuální kód **posunutý** už teď. Self-test guardu navíc končí „NEPROSEL" (očekává drift ve dvou už opravených souborech, N5). V CI guard nikdy neběžel účinně (níže).
- **CI (GitHub Actions, 87 běhů 2026-05-24 – 09-29, `16_gh_runs.json`):** workflow „CI" (lint/test/build) se nespustil ani jednou — je vázán na větve `main`/`develop`, repo má jen `master`. „Schema Drift Guard" 3× push, vždy `need NEON_API_KEY` → selhal. „RLS Gate" 46× success, ale běh je **přeskočený** kvůli chybějícímu secret `DATABASE_URL` (`16b_rls_gate_run.txt`: `##[warning]chybi secret DATABASE_URL — RLS drift se NEKONTROLUJE`). „Database backup to S3" 19/19 selhání (chybí `awscli`/`SLACK_WEBHOOK_URL`). „Security" (gitleaks) 19/19 selhání. **Žádná ochrana v CI reálně nechrání.**
- **Secrets v git historii:** gitleaks 26 nálezů (`13_gitleaks.json`), po prověření žádný živý secret — názvy sloupců (`meta_capi_token`), testovací fixtures, `.env.example` s prázdnými hodnotami, ukázkové `Bearer <token>` v dokumentaci. `git log -S 'napi_'`/`'npg_'` na skutečné klíče = 0 zásahů. Shoduje se s pamětí projektu (repo bylo 7 týdnů veřejné, reálné secrets neunikly).

## 6. Co chybí oproti plánu (řazeno podle blokace ostrého provozu)

1. **Vrácení peněz přes bránu** (C-46) — bez něj nelze refundovat ani stornovat reálné platby. K2.
2. **Funkční expirace rezervací + rate-limit nákupu + vracení míst po zrušení platby** (C-20, C-61, C-33) — bez toho lze kapacitu blokovat zdarma. K3.
3. **Uzavřít neautentizované/neplacené „demo" prodejní cesty** — všech **pět** za běhu potvrzeno (kiosk, resale/buy, ticket upgrade, voucher confirm, subscription holder confirm; `s3_e2e_10`). K1.
4. **Reset hesla** (C-02). V1.
5. **Rozhodnout produkční DB roli:** přepnutí na `tixly_app` rozbije PDF, storno, **POS/pokladnu i self-refund** (V2 + session 3) a odhalí děravý RLS zápis (V8) i 156 tabulek bez RLS; ponechání `neondb_owner` znamená RLS zcela mimo hru. Ani jedna varianta není bez ztráty funkcí nebo bezpečnosti — vyžaduje opravu, ne jen volbu. C-60.
6. **Uzávěrka prodeje po začátku akce** (C-29) a **dedikované zrušení akce s hromadným refundem** (C-14) — v kódu nenalezeny.
7. **Vstupenka zdarma** (C-36, V6), **sken cizí akce** (V3), **zápis scan_logs** (V4).
8. **Reálné platební brány, e-mail, doména/HTTPS, právní texty a firemní údaje, moderace mimo mock** — otevřené položky `GO-LIVE-CHECKLIST.md` fáze 1, mimo dosah auditu.
9. **CI, které skutečně běží** (opravit trigger větví, doplnit secrets pro drift/RLS gate).
10. **Výplaty/settlement** (C-57) — `REMEDIATION.md:171-177` sám uvádí „výplaty nefungují"; ověřeno jen to, že přehled vrací 200 s `source:"computed"` a mock id.
11. **Checkout předplatného** (C-56, S8) — 500 na `ON CONFLICT` drift; předplatné nelze koupit oficiální cestou.

## 7. Co nešlo ověřit a co je k tomu potřeba

- **Skutečný stav produkce** (role aplikace, hodnoty env `DATABASE_URL`/`DATABASE_URL_DIRECT`/`ALLOW_MOCK_PAYMENTS`/`CRON_SECRET`/`PAYPAL_WEBHOOK_ID`/`WISE_WEBHOOK_SECRET`, nasazený commit). Potřeba: přístup k produkčnímu Vercel projektu nebo read-only výpis env; Vercel API bylo během auditu nedostupné (ECONNREFUSED). Bez toho nelze potvrdit, že K1–K3 a V8/V9 platí i na produkci s produkčním schématem — zde jsou měřené proti schématu z migrací.
- **Reálné platby GoPay/ComGate** (podpis callbacku na ostro, chování brány pro částku 0, reálný refund). Potřeba: sandbox klíče. Testováno proti simulátoru `audit/tools/fake-gopay.mjs`.
- **Offline režim skeneru** (klientská IndexedDB fronta + ověření proti manifestu). Potřeba: běh v prohlížeči / Playwright. Ověřen jen serverový manifest.
- **Regrese „výpadek gate" za běhu** (guestlist check-in, cross-pass). **Zůstává NEOVĚŘENO** za běhu (runtime test nepsán záměrně) — jediný důkaz je statický: drift guard i jeho self-test ukazují dotčené routy jako čisté (`08_drift_guard_baseline.log`, GREEN u `guestlist/checkin` a `cross-pass`). Pozn.: samotný guestlist check-in přes standardní guest (nikoli cross-pass) v session 3 funguje (`s3_e2e_11:OP3b`); regrese cross-pass řetězce tím ověřená není.
- **~~Řetězec „demo" cest~~ → OVĚŘENO v session 3** (`s3_e2e_10`): resale/buy, upgrade, voucher confirm i subscription confirm dotaženy až do vydané vstupenky/zůstatku bez platby. Ponecháno zde jen jako záznam, že položka již není otevřená.
- **~~POS/pokladna, guestlist, comps~~ → OVĚŘENO v session 3** (`s3_e2e_11`): comps a guestlist fungují, POS je rozbité pod `tixly_app` (viz V2/část 3). **Nadále netestováno:** exporty nad rámec CSV, obsah faktur a DPH, výplaty (časový rozpočet).
- **Zneužitelnost jednotlivých npm zranitelností** v tomto nasazení — `npm audit` hlásí verze, ne exploitovatelnost.
