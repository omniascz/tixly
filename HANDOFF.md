# HANDOFF.md — Track B (concurrency) + schema-drift audit → remediační session

> **Účel:** předávací dokument. Shrnuje VŠE, co Track B a schema-drift sweep našly, seřazené
> dle severity, s přesnými `soubor:řádek`, root cause, hranicí commitu a navrženým fixem.
> **Nic není opraveno — jen zmapováno.** Zdroje: `FINDINGS_CONCURRENCY.md`, `FINDINGS_SCHEMA_DRIFT.md`,
> `TESTING_MAP.md`, `FINDINGS_RLS.md`. Vše ověřeno proti prod-clone Neon větvi (role `tixly_app`,
> RLS aktivní) + přečtením kódu. Datum: 2026-07-04.
>
> Cesty jsou relativní k `nextjs-boilerplate/src/app/api/` (není-li uvedeno jinak).

---

## 1) Nálezy seřazené dle severity

### 🔴 #1 FALSE SUCCESS — refund/cancel „zruší" objednávku, ale nezruší
- **Co se děje:** buyer zruší zaplacenou objednávku → dostane **HTTP 200 „Objednávka zrušena, refund
  do 7 dní"**, ale v DB se **nic nestane** (order zůstává `paid`, lístky `valid`, žádný refund_request).
- **Soubor:** `buyer/orders/[orderId]/cancel/route.ts:141` (INSERT), COMMIT na `:151`.
- **Root cause:** `INSERT INTO orders.refund_requests (order_id, amount_halire, …)` — sloupec
  **`amount_halire` neexistuje** (je `refunded_halire`). 42703 zabortuje transakci; INSERT je obalený
  `.catch(() => null)` (`:148`), takže se chyba spolkne, ale `COMMIT` na aborted tx Postgres provede
  **tiše jako ROLLBACK** → všechny předchozí mutace (order→cancelled, tickets→revoked, stock restore)
  se zahodí. Sekundárně: INSERT vynechává **`user_id` (NOT NULL, ověřeno)** — rozbité dvojnásobně.
- **Boundary:** PŘED commit, ale efekt = **tichá lež** (nejhorší třída — horší než viditelná 500).
- **Fix:** `amount_halire` → `refunded_halire`, doplnit `user_id`; NEspolykat chybu tiše
  (rozlišit aborted-tx stav) — jinak COMMIT-jako-ROLLBACK maskuje selhání jako úspěch.

### 🔴 #2 GATE OUTAGE — cross-pass holder neprojde u vstupu
- **Co se děje:** každý platný cross-festival pass u brány → 500 → **odmítnut** (deny-only).
- **Soubor:** `admin/scanner/cross-pass/route.ts:171` (INSERT), COMMIT na `:183`.
- **Root cause:** `INSERT INTO tickets.cross_pass_redemptions (… event_day_id …)` — **`event_day_id`
  neexistuje** (tabulka má `event_id,id,membership_id,redeemed_at,scanned_by_user_id`).
- **Boundary:** PŘED commit → čistý rollback, žádná korupce, ale **totální výpadek brány** pro cross-pass.
- **Fix:** odstranit `event_day_id` z INSERT listu (sloupec v tabulce prostě není).

### 🔴 #3 GATE OUTAGE — guestlist host neprojde u vstupu
- **Co se děje:** každý host z guestlistu při check-inu → 500 → **odmítnut**.
- **Soubor:** `admin/events/[id]/guestlist/checkin/route.ts:77` (UPDATE, první mutace).
- **Root cause:** `UPDATE orders.guestlist_entries SET … updated_at = NOW()` — **`updated_at`
  neexistuje** (tabulka má `checked_in_at`, ne `updated_at`).
- **Boundary:** PŘED commit (první mutace) → stav konzistentní (host není attended, lístek není used).
- **Fix:** odstranit `updated_at` (nebo použít `checked_in_at`).

### 🔴 #4 RACE — double issuance (dvojí vydání lístků, §3.4)
- **Co se děje:** jedna platba → 2× lístky. **Potvrzeno měřením: 6 lístků pro M=3** (2× order-completed
  souběžně), reprodukováno 2/2.
- **Soubor:** `internal/order-completed/route.ts:409` volá `issueTicketsForOrder(orderId, db())`
  sdíleným poolem; issuer `lib/tickets/demo-issuer.ts:63` dělá read-check `SELECT … WHERE order_id`
  pak M INSERTů — **žádný lock, žádná zastřešující transakce, žádný `UNIQUE(tickets.order_id)`**
  (ověřeno: 2 indexy na order_id, oba neuniqní).
- **Dosažitelnost = P1:** webhook flipy na `paid` JSOU guardované (`WHERE status='pending' RETURNING`),
  takže retry sám nezdvojí — ALE issuer se volá na už-`paid` order z více míst bez locku, které se
  vzájemně nevylučují: `order-completed` (fire-and-forget z webhooku), `buyer/orders/[orderId]/ticket-pdf/route.ts:93`
  (lazy issue při stažení PDF), `admin/orders/[orderId]/support-action/route.ts:96` (resend_email),
  `charity/claim/[token]/route.ts:233`, `partner/sales/route.ts:152`. Dva časově překryvné → 2M.
- **Boundary:** autocommit per query (bez tx) — commituje zdvojené lístky natrvalo.
- **Fix:** `UNIQUE (order_id, …)` na `tickets.tickets` + `ON CONFLICT DO NOTHING`, NEBO `SELECT … FOR
  UPDATE` na order řádku uvnitř `issueTicketsForOrder` (advisory lock na `order_id`) v jedné transakci.
  Samotný read-check na sdíleném poolu bezpečný být nemůže.

### 🟠 #5 ORPHAN po commitu — foyer pre-order
- **Co se děje:** kupující s foyer objednávkou (`foyerItems`) → 500 **po commitnuté** (pending) objednávce,
  která už drží inventář → nedostane gatewayUrl → nezaplatí → orphan pending do expiry.
- **Soubor:** `checkout/route.ts:2201` (INSERT `orders.foyer_orders` — `user_id` + `buyer_email` neexistují;
  tabulka má `items` jsonb, `total_halire`, `order_id`, `status`); `:2211` (INSERT `orders.foyer_order_items`
  — **celá tabulka neexistuje**). COMMIT je na `:2128` (tj. tyto běží PO něm, přes `db()` autocommit,
  bez lokálního try/catch → outer catch `:2438` → 500).
- **Boundary:** **PO commit** → nekonzistence (objednávka existuje, buyer vidí chybu).
- **Fix:** přepsat na skutečné schéma (`foyer_orders` bez user_id/buyer_email; `foyer_order_items` neexistuje
  — nejspíš konsolidováno do `foyer_orders.items` jsonb). Pozn.: `:2211` je sekundární, `:2200` padne dřív.

### 🟠 #6 ORPHAN po commitu — digitální program
- **Co se děje:** kupující s `addProgram:true` → 500 po commitnuté objednávce (jako #5).
- **Soubor:** `checkout/route.ts:2233,:2235` — `SELECT id, program_price_halire FROM catalog.event_programs
  WHERE … is_published = true …` — **`program_price_halire` ani `is_published` neexistují** (`event_programs`
  je rozvrhová tabulka: artist_name, starts_at, ends_at…). PO COMMITu (`:2128`).
- **Boundary:** **PO commit** → nekonzistence.
- **Fix:** cílit správnou tabulku/sloupce (kód míří na jiný koncept, než v schématu existuje).

### 🟡 #7 Čistá 500 / dead feature — seated checkout (P1-kritické, ale fail-safe)
- **Soubor:** `checkout/route.ts:655,:710` — čte `x, y` z `catalog.event_seats`, sloupce jsou
  **`x_coord`/`y_coord`**. PŘED commit. **Spouštěč:** každý `is_seated` ticket type → **seated prodej mrtvý**.
- **Fix:** `x, y` → `x_coord, y_coord` (a navazující čtení `s.x`/`s.y`).

### 🟡 #8 Čistá 500 — per-buyer limit
- **Soubor:** `checkout/route.ts:896,:922` — `o.buyer_email` (orders.orders sloupec nemá; email je v
  `identity.users`). PŘED commit. **Spouštěč:** `events.max_tickets_per_buyer > 0` NEBO
  `ticket_types.max_per_buyer > 0` → daný typ nelze koupit (`max_per_user` na `:948` je OK — jen user_id).
- **Fix:** zahodit **redundantní** `OR LOWER(o.buyer_email) = LOWER($3)` (`o.user_id = $2` už téhož kupce
  pokrývá; userId z upsertu téhož emailu `:877`), nebo joinnout `identity.users u` a použít `u.email`.

### 🟡 #9 Čistá 500 — parking bundle
- **Soubor:** `checkout/route.ts:1979` — `INSERT orders.bundle_items (… price_halire … status)`:
  **`price_halire`** (má být `unit_price_halire`/`total_price_halire`) a **`status`** (tabulka status nemá).
  PŘED commit. **Spouštěč:** `parkingOfferId`. **Fix:** správné cenové sloupce, `status` vypustit.

### 🟡 #10 Čistá 500 — lottery winner z kampaní
- **Soubor:** `checkout/route.ts:1823` — `UPDATE orders.lottery_entries SET … updated_at = NOW()`:
  **`updated_at` neexistuje** (jen `created_at`). PŘED commit. **Spouštěč:** `lotteryEntryId` s
  `source='campaigns'` (větev `catalog.lottery_entries` na `:1829` je OK). **Fix:** vypustit `updated_at`.

### 🟡 #11 Dead feature — token-based P2P transfer
- **Soubor:** `my/tickets/[ticketId]/transfer/route.ts:103` (INSERT … RETURNING `token`),
  `tickets/transfer/[token]/route.ts:26,:62` (WHERE `token`) — `orders.ticket_transfers.token`
  **neexistuje** (je `transfer_token`). PŘED commit / read → fail-safe. **Celý token-P2P (create+accept)
  mrtvý.** Konzumace `transferRes.rows[0].token` na `my/tickets/…:116` taky.
- **Fix:** `token` → `transfer_token` (3 SQL místa + 1 konzument). **POZOR:** existuje paralelní funkční
  P2P přes `tickets.transfer_invitations` — neopravovat/nemíchat s ním.

---

## 2) DRŽÍCÍ invarianty — NEOPRAVOVAT (ověřeno funkční)

| Oblast | Důkaz | Kde |
|---|---|---|
| **Oversell (§3.1)** DRŽÍ | 20 souběžných na stock=5 → přesně 5, remaining_qty=0, nikdy <0 | atomický `UPDATE … WHERE remaining_qty >= $1` `checkout/route.ts:1887` + `CHECK(>=0)` |
| **Seat-hold** funguje | seed C: sedadlo korektně `held` přes hold endpoint | `events/[id]/seats/hold/route.ts:107` (FOR UPDATE) |
| **Hlavní scanner validate** čistý | 0 driftu; vč. modular/flex-pass/TOTP/redemptions/scan_logs | `admin/scanner/validate/route.ts` (+ validate-nfc, validate-group, reentry, hardware/scan, rfid/scan) |
| **Direct transfer** čistý | 0 driftu | `buyer/tickets/[ticketId]/transfer/route.ts` |
| **Resale** čisté | všechny dotazy cílí `resale.resale_listings`, všechny sloupce existují | `buyer/tickets/[ticketId]/list-for-resale`, `buyer/resale/*`, `resale/purchase/[listingId]`, `internal/resale/complete-transfer`, `events/[id]/resale-listings` |
| **P2P přes `transfer_invitations`** funguje | 0 driftu (druhá, funkční P2P cesta) | `buyer/tickets/[ticketId]/transfer-invite` → `transfer/accept/[token]` |
| **order-completed / seats/hold SQL** čisté | 0 driftu | (drift jen ve volání issueru bez locku — viz #4, ne v SQL) |
| **Refund core cesty** čisté | 0 driftu (~38 dotazů) | admin/buyer refund, refund-requests, bulk-refund |

---

## 3) ODLOŽENÉ re-testy (spustit až po fixu, s podmínkou)

| Re-test | Podmínka spuštění | Jak |
|---|---|---|
| **Purchase-limit race §3.6** (útok B + B') | **až po fixu `buyer_email` (#8)** | proti `user_id` vektoru (limit se dnes nezměří — endpoint 500-uje dřív). Prověřit hypotézu, že same-email upsert-lock (`checkout:877`) race serializuje, nebo je průstřel. |
| **Seat double-sell §3.2** (útok C) | **až po fixu `x/y` coord (#7)** | 2 souběžné checkouty na týž held seat; ověřit, že FOR UPDATE (`checkout:655`) drží → 1 sold, druhý 409. |

Harness na oba je hotový: `nextjs-boilerplate/concurrency-harness.ts` (útoky A/B/C/D). Re-run:
esbuild bundle → node, env `TEST_DATABASE_URL` (tixly_app) + `TEST_ADMIN_DATABASE_URL` (owner),
pojistka odmítne prod. **Pozor: prod-clone větev byla po tomto handoffu smazána** — pro re-test
vytvořit novou z prod (viz paměť `reference_neon_prod_clone_testing`).

---

## 4) NESWEEPNUTÉ endpointy (známé bílé místo — k doauditu)

Drift-sweep pokryl checkout + refund + scan + transfer. **Nepokryto** (drift možný, nižší provozní
dopad, doporučeno doauditovat stejnou metodou):
- **subscriptions** (buyer/subscriptions/*, plans, prorata refund)
- **POS / box-office** (admin/pos/sale, admin/events/[id]/box-office/*)
- **kiosk** (kiosk/order)
- **comps / guestlist / press create** (admin/events/[id]/comps, guestlist create, press)
- RFID zone/device CRUD, admin config CRUD, gift/voucher/loyalty write cesty.

---

## 5) META-ZÁVĚR — root cause je systémový, ne 14 bodů

Napříč všemi nálezy je **jeden root cause: části kódu jsou psané proti jinému/staršímu schématu, než
je nasazené v produkci.** 14 drift míst / 11 features / 5 endpointových skupin — to není náhodný
překlep, je to **vzor**. Statická analýza (`TESTING_MAP.md`) to nemohla odhalit, protože četla kód,
ne schéma; odhalilo to až spouštění SQL proti reálnému prod schématu.

**Doporučení: systémová obrana, ne jen 14 patchů:**
1. **Typegen ze živého schématu** — generovat TS typy z `information_schema` (např. `pg-to-ts`,
   `kysely-codegen`, `zapatos`, nebo Prisma introspect) a psát dotazy typovaně; překlep sloupce
   pak spadne při buildu, ne v runtime na akci.
2. **CI kontrakt-test „každý SQL vs schéma"** — v CI proti DB s prod schématem `PREPARE`/`EXPLAIN`
   každý SQL dotaz z route handlerů (nebo statický extraktor SQL stringů + kontrola sloupců proti
   `information_schema`). Zachytí 42703 před deployem. Tenhle audit je vlastně ruční verze tohohle testu.
3. **Smoke E2E per feature-konfigurace proti prod-clone** — projet checkout se seated / limitem /
   parking / foyer / program / lottery; refund cancel; cross-pass a guestlist scan. Většina 14 nálezů
   by spadla na první ostré konfiguraci.
4. **Schema-migrace disciplína** — drift vzniká, když se sloupce přejmenují v migraci, ale kód/jiná
   větev zůstane. Baseline (`db/baseline.sql`, 2026-06-01) je navíc ZA produkcí (viz `FINDINGS_RLS.md`) —
   sjednotit zdroj pravdy o schématu.

Bodové fixy (#1–#11) jsou nutné hned (zvlášť FALSE SUCCESS a GATE OUTAGE), ale bez systémové obrany
(#1/#2) se stejná třída bugů vrátí při příští migraci.

---

## Přílohy / zdroje
- `FINDINGS_CONCURRENCY.md` — útoky A/B/C/D + triage dosažitelnosti D.
- `FINDINGS_SCHEMA_DRIFT.md` — master drift tabulka (14 míst) + severita PŘED/PO-commit.
- `TESTING_MAP.md` — role/RLS, stavové automaty, invarianty (statická mapa; §3.6/§3.2 korigované tímto auditem).
- `FINDINGS_RLS.md` — RLS ověření (baseline je ZA prod; name-drift v RLS je samostatná, oddělená věc).
- Harness: `nextjs-boilerplate/concurrency-harness.ts`.
