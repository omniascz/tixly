# FINDINGS_CONCURRENCY.md — Track B (souběžnostní testy invariantů)

> **Cíl DB:** Neon prod-clone větev `trackb-concurrency` (`br-raspy-thunder-alrfod4v`,
> endpoint `ep-withered-dew-almp8h1f…`), role **tixly_app** (`bypassrls=false` → RLS reálně platí).
> Throwaway větev, mimo produkci (pojistka harnessu aktivní: odmítne prod markery).
> **Datum:** 2026-07-04.
>
> **Metoda:** golden path **přímým importem** route handlerů (`checkout`, `internal/order-completed`,
> `events/[id]/seats/hold`) — middleware schválně obejit, identita přes hlavičku `x-user-id`
> (resp. `x-internal-token` u interního endpointu). Collision engine = `Promise.all(N)`, každé volání =
> vlastní connection z rls-poolu. **Každý assert proti REÁLNÉMU STAVU DB** (SELECT přes owner/bypassrls
> pool = ground truth), nikdy proti odpovědi API.
>
> Harness: `nextjs-boilerplate/concurrency-harness.ts`. Běh: esbuild bundle (auto tsconfig paths)
> → `node`. Env `TEST_DATABASE_URL` (tixly_app) + `TEST_ADMIN_DATABASE_URL` (owner).

## Naměřené výsledky

| Útok | Verdikt | Detail | HTTP statusy |
|---|---|---|---|
| **A) Oversell GA (§3.1)** | ✅ **DRŽÍ** | stock=5, 20 souběžných po 1 ks (různí kupci) → **commitnutých objednávek = 5**, **remaining_qty = 0** (nikdy <0) | `200×5, 409×15` |
| **B) Purchase-limit race (§3.6)** | ⚠️ **NEMĚŘITELNÉ (checkout 500)** | max_per_buyer=2, 5 souběžných → **všech 5 → 5xx, 0 objednávek**. Blokuje bug `buyer_email` (P1 #1). | `500×5` |
| **D) Double issuance (§3.4)** | 🔴 **PRŮSTŘEL (potvrzeno)** | 1 paid order, M=3, **2× `order-completed` SOUČASNĚ → 6 lístků (2M)**. Reprodukováno 2/2. | `200×2` |
| **C) Seat double-sell (§3.2)** | ⚠️ **NEMĚŘITELNÉ (checkout 500)** | 1 held seat, 2 souběžné checkouty → **oba 5xx, 0 sold**. Blokuje bug `x`/`y` (P1 #2). | `500×2` |

**Skóre:** 1 invariant DRŽÍ (A), **1 potvrzený průstřel (D)**, 2 útoky nezměřitelné kvůli **dvěma
samostatným P1 schéma-bugům v checkoutu** (B: `buyer_email`, C: `x`/`y`). Oba maskované race
(§3.6, §3.2) zůstávají **nerozhodnuté** — po opravě bugů nutný re-test.

---

## 🔴 P1 #1 (POTVRZENO) — checkout 500-uje při jakémkoli per-buyer limitu

**BUG:** Nákup se rozbije, jakmile je nastaven per-buyer limit.

- **Příčina:** `checkout/route.ts:896` a `:922` čtou `o.buyer_email`, ale `orders.orders`
  **tento sloupec nemá** (ověřeno tvrdě: 67 sloupců, žádný email kupujícího; email je v
  `identity.users` přes `o.user_id`). `o` je jednoznačně `orders.orders` (JOIN `:893`/`:919`).
  Postgres **`column o.buyer_email does not exist` (42703)** už při plánování → `catch` (`:46`) →
  **HTTP 500** → ROLLBACK, žádná objednávka.
- **Deterministické, ne datově závislé.** Empiricky **500×5** (útok B).
- **Dopad:** `events.max_tickets_per_buyer > 0` **NEBO** `ticket_types.max_per_buyer > 0` →
  daný typ nelze koupit. Tichá funkční regrese: promotér zapne limit v dobré víře → utne si prodej.
  `ticket_types.max_per_user` (`:948`, jen `o.user_id`) je **OK**.
- **Fix (později):** zahodit redundantní `OR LOWER(o.buyer_email) = LOWER($3)` (`o.user_id = $2` už
  téhož kupce pokrývá, userId z upsertu téhož emailu `:877`); nebo joinnout `identity.users u` (`u.email`).
- **⚠️ ODLOŽENÝ RE-TEST §3.6:** bug maskuje race count-then-check bez zámku. Race **není vyvrácen,
  jen nedosažitelný** — po fixu spustit B + B' proti `user_id` vektoru.

---

## 🔴 P1 #2 (POTVRZENO) — seated checkout vždy 500-uje (špatné názvy sloupců x/y)

**BUG:** Nákup vstupenky s přiřazeným sedadlem (`ticket_types.is_seated=true`) vždy spadne.

- **Příčina:** seated větev checkoutu čte `x, y` z `catalog.event_seats`:
  - `checkout/route.ts:655`: `SELECT id, status, ticket_type_id, hold_until, x, y FROM catalog.event_seats …`
  - `checkout/route.ts:710`: `SELECT id, x, y FROM catalog.event_seats …`
  Tabulka ale sloupce `x`/`y` **nemá** — jmenují se **`x_coord`/`y_coord`** (ověřeno:
  `information_schema.columns` na `catalog.event_seats`). Postgres **`column "x" does not exist`
  (42703)** → `catch` (`:46`) → **HTTP 500** → ROLLBACK.
- **Deterministické.** Empiricky **500×2** (útok C). Nastane u každého `is_seated` ticket_type.
- **Dopad:** **seated vstupenky nelze koupit vůbec** (celá seated větev prodeje mrtvá). Seat hold
  (`events/[id]/seats/hold`) přitom funguje — sedadlo se dá „podržet", ale nedá dokončit nákup →
  sedadlo zůstane `held` do expiry. Stejná třída bugu jako P1 #1 (kód vs. prod schéma).
- **Fix (později):** v obou dotazech přejmenovat `x, y` → `x_coord, y_coord` (a navazující čtení `s.x`/`s.y`).
- **⚠️ ODLOŽENÝ RE-TEST §3.2:** double-sell race (FOR UPDATE na seatu, `route.ts:655`) je **nedosažitelný**
  — checkout umře dřív. Invariant §3.2 „DRŽÍ" **není ověřen přes checkout**; po fixu spustit útok C znovu.

---

## D) Double issuance — 🔴 PRŮSTŘEL (potvrzený breach)

**Invariant (§3.4):** jedna zaplacená objednávka → přesně M lístků, i při opakovaném/souběžném
`order-completed`. **Naměřeno: 2× M.**

### Reprodukce (minimální)
1. Seed: 1 řádek `orders.orders` se `status='paid'`, 1 `order_items` s `quantity = M` (M=3), žádné lístky.
2. Zavolej `POST /api/internal/order-completed` **2× SOUČASNĚ** (`Promise.all`, `x-internal-token`)
   na tentýž `orderId`.
3. Assert proti DB: `SELECT count(*) FROM tickets.tickets WHERE order_id = X`.

**Výsledek:** `6` (= 2M), oba requesty vrátily `200`. Ground-truth potvrzeno na dvou nezávislých
objednávkách (obě `ordered_qty=3 → issued_tickets=6`), tj. **reprodukováno 2/2**.

### Proč to prostřelí (mechanismus, ověřeno)
- `order-completed` volá issuer **se sdíleným poolem, bez zastřešující transakce/locku**:
  `issueTicketsForOrder(orderId, db())` (`order-completed/route.ts:409`).
- V rls-poolu se **každý `db().query()` autocommituje ve vlastní transakci** — takže idempotentní
  read-check `SELECT … FROM tickets.tickets WHERE order_id=$1` (`demo-issuer.ts:63`) a následné
  `INSERT`y (`demo-issuer.ts:136`) **nejsou pod žádným společným zámkem**.
- Obě souběžné invokace projdou read-check (obě vidí 0 lístků, dřív než kterákoli stihne INSERT) →
  obě vloží M → **2M**.
- **Žádná DB pojistka:** na `tickets.tickets(order_id)` **není UNIQUE** (ověřeno: 2 indexy
  `idx_tickets_order_status`, `idx_tickets_tickets_order_id`, oba `indisunique=false`).
- Přesně odpovídá predikci TESTING_MAP.md §3.4 (read-then-write, žádný UNIQUE, žádný order-level lock).

### Dopad
Jeden platební webhook doručený 2× (nebo jakékoli 2 souběžné `order-completed`) vydá **dvojnásobek
lístků** za jednu platbu → nadměrný počet platných vstupenek (over-admission), rozpad kapacity,
finanční/fraud riziko. Za normální golden path to tlumí single-fire mock webhook, ale žádná
**strukturální** ochrana (lock/UNIQUE) neexistuje — retry brány, duplicitní doručení nebo cron
by to spustily.

### Fix (později, ne teď)
Buď `UNIQUE (order_id, …)` na `tickets.tickets` + `ON CONFLICT DO NOTHING`, nebo issuer obalit
`SELECT … FOR UPDATE` na order řádku (advisory/row lock) v jedné transakci, aby read-check+insert byly atomické.

---

## A) Oversell — DRŽÍ (potvrzeno měřením)

20 souběžných kupců na 5 kusů → **přesně 5** uspělo, 15× `409`, `remaining_qty=0`, nikdy záporná.
Mechanismus: atomický `UPDATE catalog.ticket_types SET remaining_qty = remaining_qty - $1 WHERE id=$2
AND remaining_qty >= $1 RETURNING` (`route.ts:1887`) — serializace na row-locku, poražený `rowCount=0`
→ ROLLBACK + `409` (`:1894`); DB backstop `CHECK (remaining_qty >= 0)`. Shoduje se s §3.1 (DRŽÍ).
Zároveň sanity, že harness měří skutečnou souběžnost.

## B) Purchase-limit race — NEMĚŘITELNÉ (viz P1 #1)

max_per_buyer=2, 5 souběžných (týž buyerEmail) → všech 5 → **500** (bug `buyer_email`), 0 objednávek.
Harness případ „všech N → 5xx a 0 objednávek" hlásí jako **NEMĚŘITELNÉ** (ne falešné DRŽÍ). Hypotéza
o serializaci upsert-lockem (`route.ts:877`) je netestovatelná — endpoint umře dřív. Race §3.6 nerozhodnut.

## C) Seat double-sell — NEMĚŘITELNÉ (viz P1 #2)

1 sedadlo `held` (přes `seats/hold` — to funguje), 2 souběžné checkouty na týž seat → oba **500**
(bug `x`/`y`), 0 sold. Harness hlásí **NEMĚŘITELNÉ** (ne falešné PRŮSTŘEL — sedadlo se neprodalo
2×, checkout jen spadl). FOR UPDATE seat-lock (`route.ts:655`) nedosažen. Race §3.2 nerozhodnut.

---

## Oprava mapy (TESTING_MAP.md)

- **§3.4 (double issuance):** mapa predikovala PRŮSTŘEL — **potvrzeno měřením** (2M lístků).
- **§3.1 (oversell):** mapa DRŽÍ — **potvrzeno**.
- **§3.6 (purchase limit) a §3.2 (seat double-sell):** mapa je brala jako funkční (racy resp. DRŽÍ).
  Živý běh ukázal, že **obě příslušné checkout větve vůbec neběží** kvůli schéma-neshodám
  (`buyer_email`, `x`/`y`) — statická analýza je neviděla. Oba race jsou tím **maskované, ne rozhodnuté**.

---

## Reprodukce & úklid
- Harness: `nextjs-boilerplate/concurrency-harness.ts` (útoky A/B/D/C). Rebuild:
  `npx esbuild concurrency-harness.ts --bundle --platform=node --format=cjs --packages=external
  --outfile=harness.build.cjs` → `node harness.build.cjs`. Build artefakt smazán po běhu.
- V harnessu opraven **jen měřicí kód** (asserty proti reálné DB; verdikt rozlišuje 500-only case
  jako NEMĚŘITELNÉ, aby nevznikaly falešné DRŽÍ/PRŮSTŘEL). **Route ani schéma netknuté.**
- Testovací větev `trackb-concurrency` (`br-raspy-thunder-alrfod4v`) **ponechána** (throwaway) pro
  odložené re-testy B'/C po fixu bugů. Ke smazání: `DELETE …/branches/br-raspy-thunder-alrfod4v`.

---

# Schema-drift (checkout + další endpointy) → přesunuto do FINDINGS_SCHEMA_DRIFT.md

Checkoutových **6 drift konfigurací** (buyer_email, x/y, bundle_items, lottery, foyer, program) +
sweep refund/scan/transfer je nově v **`FINDINGS_SCHEMA_DRIFT.md`** (už to není concurrency).
Zde ponechána jen concurrency část — triage dosažitelnosti bugu D níže.

---

# Triage dosažitelnosti bugu D (double issuance) — verdikt: P1

**Otázka:** existuje v prod reálná cesta, kde `issueTicketsForOrder` běží 2× na tentýž `paid` order
(bez locku, bez UNIQUE) → 2M lístků?

**Zjištění 1 — webhook retry SÁM nestačí (flip je guardovaný).** Každý platební provider flipuje
order → `paid` **atomicky**: buď `SELECT … FOR UPDATE` + bail na `status!=='pending'`, nebo
`UPDATE … WHERE status='pending' RETURNING` gated na `rows.length>0`. Postgres serializuje →
`order-completed` se fajruje **jen na první** pending→paid tranzici. Retry téhož webhooku (i cross-provider
závod na flipu) je tím de-duplikovaný. **Takže framing „webhook retry" NEsedí.**

**Zjištění 2 — expozice je z issuerů, co běží na UŽ-`paid` order sdíleným `db()` bez locku.**
Callery `issueTicketsForOrder` (ověřeno gerepem):

| Caller | connection | flipuje order? | může běžet na už-`paid` order? |
|---|---|---|---|
| `internal/order-completed:409` | **sdílený `db()`** | ne (jen `status!=='paid'` skip :324) | **ANO** (fire-and-forget z webhooku) |
| `buyer/orders/[orderId]/ticket-pdf:93` | **sdílený `db()`** | ne (čte `WHERE status='paid'`) | **ANO — lazy issue při každém stažení PDF** |
| `admin/orders/[orderId]/support-action:96` (`resend_email`) | fetch → order-completed, fire-and-forget | ne | **ANO — re-trigger na paid order** |
| `charity/claim/[token]:233` | **sdílený `db()`** | (claim flow) | ANO na příslušný order |
| `partner/sales:152` | **sdílený `db()`** | vytváří vlastní order | většinou single-shot |
| comps:232, guestlist:159, press:179, pos/sale:228, kiosk:134, mobile/order-confirm:85, reseller/sale:115 | dedikovaný `client` (vlastní tx) | vytváří **nový** order | ne (single-shot na čerstvý order) |

**Zjištění 3 — žádný z shared-`db()` issuerů se vzájemně nevylučuje** (sdílený pool, každý query
autocommit, žádný row-lock na order, žádný UNIQUE(tickets.order_id)). Reálný dosažitelný overlap:
- **`order-completed` (fire-and-forget z vítězného webhooku) ⟂ `ticket-pdf` (buyer stáhne PDF).**
  Webhook po flipu spustí async order-completed (renderuje PDF + email = pomalé); pokud buyer v tom
  okně otevře `GET /ticket-pdf`, oba volají issuer na sdíleném poolu → oba čtou 0 → 2M.
- **fire-and-forget order-completed na serverless nemusí doběhnout** → první issuance je až lazy;
  dvě souběžné lazy issuance (support `resend_email` ⟂ `ticket-pdf`, nebo dvojklik/prefetch `ticket-pdf`)
  → 2M. Nepotřebuje sub-sekundové okno, protože nikdo nedrží lock.

**Verdikt: P1.** Existují **produkční ne-mockové vstupní body** (`order-completed` fire-and-forget,
`ticket-pdf` lazy issue, `support resend`), které issue-ují na už-`paid` order sdíleným poolem bez
locku a bez UNIQUE. Libovolné dva časově překryvné → dvojité vydání. Není to jen teoretický
webhook-retry (ten je naopak korektně de-duplikovaný) — je to reálná souběžnostní cesta.
*(Poctivé zúžení: mock brány jsou v produ blokované; k `ticket-pdf` jsem nenašel in-app UI odkaz —
je dosažitelný přímo / z e-mailových odkazů, což jistotu spouště snižuje, ale neruší.)*

**Fix (později, ne teď):** `UNIQUE (order_id, …)` na `tickets.tickets` + `ON CONFLICT DO NOTHING`,
nebo `SELECT … FOR UPDATE` na order řádku uvnitř `issueTicketsForOrder` (advisory lock na `order_id`)
— samotný read-check na sdíleném poolu bezpečný být nemůže.
