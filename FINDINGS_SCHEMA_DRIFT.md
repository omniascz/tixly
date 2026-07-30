# FINDINGS_SCHEMA_DRIFT.md — schema-drift sweep hot endpointů

> **Co to je:** systematický sweep SQL dotazů v provozně kritických endpointech proti
> **skutečnému schématu produkce** (prod-clone Neon větev `trackb-concurrency`), který hledá
> odkazy na sloupce/tabulky, jež v DB **neexistují** — každý je latentní runtime chyba (42703)
> → 500 nebo horší. **Read-only, nic se neopravuje.**
>
> **Metoda:** stažen kompletní inventář sloupců větve (`information_schema`, 607 tabulek →
> `branch-columns.json`). Pro každý endpoint: každý SQL dotaz → alias namapován z FROM/JOIN →
> každý odkazovaný sloupec (kvalifikovaný i nekvalifikovaný) ověřen proti inventáři.
> **Každý nález níže je ověřen dvakrát:** proti inventáři a živým `information_schema` dotazem
> proti větvi + přečtením SQL řádku (atribuce tabulky). Kde byla tabulka aliasu nejasná, agent to
> označil jako otázku — žádné otázky nezůstaly otevřené.
>
> **Boundary = severita:** dotaz **PŘED COMMITem** → čistý ROLLBACK/500 (žádný nekonzistentní stav);
> dotaz **PO COMMITu** (nebo autocommit po předchozí commitnuté mutaci) → **orphan / nekonzistence**
> (vyšší severita). Zvláštní kategorie: **FALSE SUCCESS** (chyba spolknuta, vrátí se 200, ale DB rollbackne).
>
> Datum: 2026-07-04. Pokrytí: checkout (84 dotazů), refund (7 souborů), scan (10), transfer (11).

## Master tabulka driftu (vše ověřeno proti DB)

| # | endpoint / soubor | řádek | `table.column` (neexistuje) | skutečný / kandidát | boundary | spouštěč |
|---|---|---|---|---|---|---|
| 1 | checkout | :655,:710 | `catalog.event_seats.x`, `.y` | `x_coord`, `y_coord` | PŘED | seated checkout (`is_seated`) |
| 2 | checkout | :896,:922 | `orders.orders.buyer_email` | (email v `identity.users`) | PŘED | per-buyer limit (`max_tickets_per_buyer`/`max_per_buyer`) |
| 3 | checkout | :1979 | `orders.bundle_items.price_halire` | `unit_price_halire`/`total_price_halire` | PŘED | parking bundle (`parkingOfferId`) |
| 4 | checkout | :1980 | `orders.bundle_items.status` | (žádný status) | PŘED | parking bundle |
| 5 | checkout | :1823 | `orders.lottery_entries.updated_at` | (jen `created_at`) | PŘED | lottery winner z `lottery_campaigns` |
| 6 | checkout | :2201 | `orders.foyer_orders.user_id` | (žádný; identita přes `order_id`) | **PO** | foyer pre-order (`foyerItems`) |
| 7 | checkout | :2201 | `orders.foyer_orders.buyer_email` | (žádný) | **PO** | foyer pre-order |
| 8 | checkout | :2211 | `orders.foyer_order_items` (CELÁ TABULKA) | (neexistuje) | **PO** | foyer (sekundární — :2200 padne dřív) |
| 9 | checkout | :2233 | `catalog.event_programs.program_price_halire` | (schedule tabulka, bez cen) | **PO** | digital program (`addProgram`) |
| 10 | checkout | :2235 | `catalog.event_programs.is_published` | (žádný) | **PO** | digital program |
| 11 | refund: `buyer/orders/[orderId]/cancel` | :141 | `orders.refund_requests.amount_halire` | `refunded_halire` | **FALSE SUCCESS** | buyer ruší paid objednávku s refundem >0 |
| 12 | scan: `admin/scanner/cross-pass` | :171 | `tickets.cross_pass_redemptions.event_day_id` | (žádný — sloupec smazat) | PŘED | cross-pass holder u brány |
| 13 | scan: `admin/events/[id]/guestlist/checkin` | :77 | `orders.guestlist_entries.updated_at` | `checked_in_at` / smazat | PŘED (1. mutace) | guestlist host u brány |
| 14 | transfer: `my/tickets/[ticketId]/transfer` + `tickets/transfer/[token]` | :103, :26, :62 | `orders.ticket_transfers.token` | `transfer_token` | PŘED | token-based P2P transfer (create + accept) |

**14 drift míst / 11 featur / 5 endpointových skupin.** Není to překlep — je to **vzor**: části kódu
psané proti jinému/staršímu schématu, než je v produkci.

---

## Severita (od nejhorší)

### 🔴 FALSE SUCCESS — refund cancel „zruší" objednávku, ale nezruší (#11)
`buyer/orders/[orderId]/cancel/route.ts`. Po commitnutelných mutacích (order→`cancelled`,
tickets→`revoked`, stock restore — vše ještě necommitnuté) přijde
`INSERT INTO orders.refund_requests (order_id, amount_halire, reason, status, promoter_id, created_at)`
(`:141`). `amount_halire` neexistuje → **42703 zabortuje transakci**. INSERT je obalený
`.catch(() => null)` (`:148`), takže se chyba spolkne — ale transakce je už v *aborted* stavu, takže
následný `COMMIT` (`:151`) Postgres **tiše provede jako ROLLBACK**. Výsledek:
- endpoint vrátí **HTTP 200 `{ok:true}`** + „Objednávka zrušena, refund bude zpracován do 7 dní",
- ale DB je **kompletně rollbacknutá**: order zůstává `paid`, lístky `valid`, žádný refund_request.

**Nejhorší třída** — nejde o viditelnou 500, ale o **tichou lež**: kupující si myslí, že zrušil a
dostane peníze, systém neudělal nic. Spouští se na primární happy-path (paid objednávka zrušená před
deadline, default `refund_pct_before_deadline=100`).
Sekundární: i po opravě `amount_halire→refunded_halire` INSERT vynechává **`user_id` (NOT NULL,
ověřeno)** → padal by dál. Tj. INSERT je rozbitý dvojnásobně.

### 🔴 GATE OUTAGE — u vstupu neprojdeš lidi (#12, #13)
Obě PŘED commit → žádná korupce dat, ale **deny-only výpadek brány** v čase akce:
- **cross-pass (#12):** `INSERT INTO tickets.cross_pass_redemptions (… event_day_id …)` (`:171`) →
  42703 → 500. **Každý** cross-festival pass holder je u brány odmítnut. Sloupec je v INSERT listu
  bezpodmínečně (nezáleží, zda se posílá `eventDayId`).
- **guestlist (#13):** `UPDATE orders.guestlist_entries SET … updated_at=NOW()` (`:77`) → 42703 → 500.
  **Každý** host z guestlistu odmítnut. Je to první mutace, takže lístek se ani neoznačí `used` →
  stav konzistentní, ale host neprojde.
Žádný drift, který by špatně *vpustil* (admit), nenalezen — oba jsou fail-deny.

### 🟠 ORPHAN / 500 po commitnuté objednávce (#6–#10, checkout)
`foyerItems` (#6–8) a `addProgram` (#9,10) běží **po COMMITu** (`:2128`) přes `db()` autocommit, bez
lokálního try/catch → propagují do outer catch (`:2438`) → 500. Objednávka (pending) je ale už
commitnutá a **drží inventář** (seat sold, remaining_qty snížené); kupující dostane 500 → nedostane
gatewayUrl → nezaplatí → **orphan pending do expiry**. Horší než čistá 500.

### 🟡 ČISTÁ 500 / dead feature (#1–#5 checkout, #14 transfer)
PŘED commit → ROLLBACK, žádný stav. Feature je ale pro danou konfiguraci **mrtvá**:
- seated prodej (#1), prodej s per-buyer limitem (#2), parking bundle (#3,4), lottery z campaigns (#5).
- **token-based P2P transfer (#14):** `orders.ticket_transfers.token` → `transfer_token` na 3 místech.
  Celý mechanismus create (`my/tickets/[ticketId]/transfer`) + accept (`tickets/transfer/[token]`) je
  100 % nefunkční, ale fail-safe. **Pozn.:** existuje **paralelní** P2P systém přes
  `tickets.transfer_invitations` (`transfer-invite` → `transfer/accept/[token]`), který je **čistý a
  funkční** — tj. jedna ze dvou P2P cest žije, druhá je mrtvá.

---

## Co bylo ČISTÉ (ověřeno, bez driftu)
- **refund:** `admin/orders/[orderId]/refund`, `buyer/orders/[orderId]/refund`, `admin/refund-requests/[id]`,
  `admin/refund-requests` (GET), `buyer/refund-requests`, `admin/orders/bulk-refund` — všech ~38 dotazů čistých.
- **scan:** `validate`, `validate-group`, `validate-nfc`, `reentry`, `manifest`, `hardware/scan`,
  `rfid/scan`, `scanner/school-group` — 8 z 10 souborů čistých (hlavní gate `validate` vč. modular/flex/TOTP čistý).
- **transfer/resale:** přímý transfer (`buyer/tickets/[ticketId]/transfer`), P2P přes `transfer_invitations`,
  a **všechny resale dotazy** (cílí jednoznačně `resale.resale_listings`, ne `orders.resale_listings`;
  parallel-tables riziko z mapy se nepotvrdilo) — čisté.
- **`internal/order-completed`, `events/[id]/seats/hold`** (z předchozího kola) — čisté.

## Metoda ověření & rozsah
Nálezy z 3 paralelních drift-agentů (refund/scan/transfer) + 1 checkout agenta; **každý confirmed-missing
sloupec jsem sám přeověřil** živým `information_schema` dotazem proti větvi a přečtením SQL řádku
(atribuce aliasu). Sweep pokryl provozně nejkritičtější cesty; nepokrývá 100 % API (např. admin config
CRUD, RFID zone/device management, subscriptions) — tam drift může být taky, ale nižší provozní dopad.
Prod-clone větev `br-raspy-thunder-alrfod4v` ponechána pro re-testy.
