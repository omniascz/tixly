# FIX_REPORT_K — oprava kritických nálezů (K1, K2, K3, V1)

**Větev:** `fix/critical-2026-09-30` (worktree `../tixly-fix`, z commitu `d4b43f4`).
**Poslední commit:** `f4ba019`.
**Metoda:** test-first, proti IZOLOVANÉ Postgres DB postavené z migrací (`localhost:55632/e2e`, role `tixly_app` = produkční) + simulátor GoPay (`tests/helpers/fake-gopay.mjs`, `:3998`) + Mailpit. **K produkční DB ani produkčním službám se fix nepřipojil.** Pracovní strom `tixly/` (92 necommitnutých změn) nebyl nijak změněn.
Regresní testy jsou ve standardní sadě projektu (`nextjs-boilerplate/tests/*.live.test.ts`, gate `FIX_E2E=1`), ne v `audit/`.

---

## 1. Nálezy — příčina, změna, test, důkaz RED→GREEN

### V1 — Reset hesla vracel 500 („column locale does not exist")
- **Příčina:** `forgot-password/route.ts` četl `SELECT id, locale, name FROM identity.users`, jenže `identity.users` sloupec `locale` nemá (42703) → celý handler 500, reset hesla nešel spustit. Per-user locale se nikde jinde v kódu nečte ani nezapisuje (grep: forgot-password byl jediný výskyt).
- **Změna (odpovídá zbytku kódu — bez mrtvého sloupce):** `src/app/api/auth/forgot-password/route.ts` — `locale` odebráno ze SELECTu, e-mail se posílá ve výchozím `cs`. **Žádná změna schématu.**
- **Test:** `tests/fix-v1-reset.live.test.ts` — celý tok: forgot → e-mail v Mailpitu → reset → login novým heslem OK / starým 401 / token jednorázový (reuse → 401); ground-truth hash v `identity.user_secrets` ověřen bcrypt compare.
- **RED:** `column "locale" does not exist` (42703) na forgot-password. **GREEN:** 2/2 po opravě.

### K3 — Kapacitu lze trvale zablokovat nezaplacenými rezervacemi (3 slčítající se vady)
- **Příčina:**
  1. Cron `expire-pending-orders` uvolňoval sedadla přes `orders.order_items.event_seat_id` — sloupec **neexistuje** (je `seat_id`) → 42703 → cron vracel **500 a neuvolnil nic**; rezervace držely kapacitu navždy.
  2. Webhook `CANCELED/TIMEOUTED` jen přepsal status, kapacitu **nevrátil**.
  3. Checkout neměl **žádný rate limit** — z jedné IP / na jeden e-mail šlo založit neomezeně nezaplacených objednávek; navíc promo `uses_count` se inkrementoval při checkoutu a expirací se nikdy nevracel.
- **Změna:**
  - `src/lib/orders/release-capacity.ts` (nový, sdílený) — vrátí GA množství z `order_items`, uvolní sedadla linknutá na objednávku (správný `seat_id`) a vrátí promo `uses_count` (+ smaže `promo_code_usages`). Volá ho cron i webhook (žádná paralelní logika).
  - `internal/cron/expire-pending-orders/route.ts` — používá helper; navíc ve stejné transakci uvolní sedadla s prošlým `hold_until` (SEATED pending držení). Už nepadá 42703.
  - `payments/gopay/webhook/route.ts` — větev CANCELED/TIMEOUTED po přechodu (`RETURNING`, guard `status='pending'`) volá `releaseOrderCapacity` → kapacita zpět okamžitě, idempotentně.
  - `checkout/route.ts` — rate limit stejným mechanismem jako login (`checkRateLimit`): **per IP 10/10 min**; **per e-mail max 5 současných živých pending objednávek** → 429.
- **Test:** `tests/fix-k3-capacity.live.test.ts` (5 kontrol): expirace vrátí GA + promo, cron nepadá 42703; expirace uvolní i sedadla (prošlý hold); zrušená platba (webhook CANCELED) → cancelled + kapacita zpět; per-IP limit (11. → 429); per-e-mail limit (6. → 429).
- **RED:** cron 500 (42703); po zrušení platby kapacita 48≠50; 12/12 i 7/7 checkoutů prošlo. **GREEN:** 5/5.

### K2 — Refund nevracel peníze (jen DB)
- **Příčina:** admin refund i buyer self-refund měnily jen DB (status `refunded`, revoke, inventář) a **platební bránu nevolaly nikdy** — `refundGopayPayment`/`refundComGatePayment` neměly žádného volajícího. Zákazník peníze nedostal, systém tvrdil „refunded".
- **Změna:**
  - **Migrace `472_refund_gateway_state.sql`:** stavy objednávky `refund_pending` / `refund_failed` (rozšířen `orders_status_check`) + sloupce `refund_initiated_at`, `refund_completed_at`, `refund_gateway_response` (jsonb), `refund_error`, `refunded_amount_halire`. Ověřeno **od nuly (25/25) i nad stávajícím schématem**, idempotentní.
  - `src/lib/payment/gateway-refund.ts` (nový) — provider-agnostické volání (GoPay, ComGate; bez payment id = comp/POS/0 Kč → skip; Mollie/PayPal záměrně nezapojeny → fail hlasitě).
  - `src/lib/payment/refund-order.ts` (nový) — sdílený stavový automat `executeOrderRefund`: `paid → refund_pending` (FOR UPDATE, idempotentní guard) → volání brány MIMO transakci → `ok`: `refunded`/`paid` + revoke/inventář/sedadla (callback) + uložení odpovědi; `chyba/timeout`: `refund_failed` + uložení chyby, **HTTP 502, lístky zůstávají**. Dvojí požadavek = jedno volání brány.
  - `gopay-real.ts` — refund fetch dostal **timeout** (`AbortSignal`, `GOPAY_REFUND_TIMEOUT_MS`); bez něj by výpadek brány držel refund navždy.
  - `admin/orders/[orderId]/refund` a `buyer/orders/[orderId]/refund` přepojeny na `executeOrderRefund`.
- **Test:** `tests/fix-k2-refund.live.test.ts` (5) + rozšíření `fake-gopay` o řízení refundu (ok/error/timeout): úspěch (brána 1×, refunded, revoke, odpověď uložena); idempotence (2 požadavky = 1 volání); chyba brány → `refund_failed` + 502 (bez revoke); timeout → `refund_failed`; self-refund invariant „nikdy `refunded` bez volání brány".
- **RED:** 0 volání brány, žádný `refund_failed` stav. **GREEN:** 5/5.
- **ComGate:** refund adaptér existuje (`refundComGatePayment`), zapojen v dispatchu; živě netestován (chybí sandbox) — testováno proti fake-gopay.

### K1 — Vstupenky / hodnota bez platby (5 cest)
- **Příčina:** pět cest vystavilo placenou hodnotu bez platby, některé bez přihlášení:
  `kiosk/order`, `buyer/resale/buy`, `buyer/tickets/[id]/upgrade`, `vouchers/holders/[paymentId]/confirm`, `subscriptions/holders/[paymentId]/confirm`.
- **Změna:**
  - **kiosk/order** — vyžaduje přihlášenou **obsluhu** (`x-user-id` z JWT přes middleware) + **oprávnění k dané akci** (platform admin NEBO aktivní člen promotéra akce); bez toho 401/403. `middleware.ts` — `/api/kiosk/` přidáno do promoter-auth prefixů (injektuje `x-user-id`). Fyzická platba (karta/hotovost) probíhá na terminálu jako u POS → proto ne gateway.
  - **resale/buy, upgrade, voucher confirm, subscription confirm** — napojení na skutečný platební tok je u každé **větší přepis**, proto **vypnuty ve výchozím stavu (404)** přes `src/lib/payment/demo-path-guard.ts`. Zapnout jen výslovně mimo produkci (`ENABLE_DEMO_PAYMENT_PATHS=1 && NODE_ENV!==production`); **v produkci vypnuté vždy**.
- **Test:** `tests/fix-k1-payment-bypass.live.test.ts` (5) — pro každou cestu anon i cizí uživatel ⇒ žádná paid objednávka / platný lístek / dobitý voucher, stav DB beze změny.
- **RED:** všech 5 vracelo 200 a měnilo stav. **GREEN:** kiosk 401/403, zbylé 4 → 404.

---

## 2. Endpointy vypnuté místo opravy (a co chybí k plnému zapojení)

| Endpoint | Stav | Co je potřeba k plnému zapojení na platební tok |
|---|---|---|
| `POST /api/buyer/resale/buy` | 404 (flag off) | Nevytvářet `paid` objednávku rovnou; vytvořit platbu u brány (`createGopayPayment`) na `ask_price`, přesměrovat kupce, a převod lístku + seller payout provést až ve webhooku po `PAID` (escrow). |
| `POST /api/buyer/tickets/[id]/upgrade` | 404 (flag off) | Vytvořit platbu na rozdíl ceny (`diffHalire`), změnu typu lístku + upgrade objednávku provést až po potvrzení platby webhookem. |
| `POST /api/vouchers/holders/[paymentId]/confirm` | 404 (flag off) | Nákup voucheru vést přes checkout+bránu; `payment_status='paid'` a dobití zůstatku nastavit výhradně ve webhooku. Navíc vyžadovat auth + ověření vlastníka (dnes bez auth). |
| `POST /api/subscriptions/holders/[paymentId]/confirm` | 404 (flag off) | Aktivaci předplatného a vydání lístků provést až po potvrzení platby webhookem; vyžadovat auth + ověření vlastníka. (Pozn.: `subscriptions/checkout` zároveň padá na `ON CONFLICT` drift — samostatný nález S8 z auditu.) |

`kiosk/order` **nebyl vypnut** — je to legitimní POS-like tok; opraven přidáním autentizace obsluhy + oprávnění k akci.

---

## 3. Výsledek hledání demo / mock / fake / bypass / skipPayment

Grep v `nextjs-boilerplate/src/app/api/**/route.ts`: `demo`=40, `mock`=208, `fake`=3, `bypass`=9, `skipPayment`=0 výskytů (většina „mock" jsou názvy mock bran a komentáře).

**Cesty, které mintovaly placenou hodnotu — dispozice:**
- 5 cest K1 — ošetřeno (kiosk auth; 4× default-off 404). Viz výše.
- Mock platební brány (`mock-gopay`, `mock-wero`, `mock-przelewy24`, `mock-bnpl`, `mock-crypto`) — **všech 5 je v produkci blokováno** `mock-guard` (`mockPaymentsAllowed()` = `NODE_ENV!=='production' || ALLOW_MOCK_PAYMENTS==='1'`; ověřeno grepem, každý endpoint volá `mockPaymentBlockedResponse`/`assertMockPaymentsAllowed`).

**Zbývá (mimo rozsah tohoto kola, doporučeno příště):** mock brány jsou dnes blokované jen v produkci, ne striktně „jen v `NODE_ENV=test`" — v dev/staging běží (pro demo). Zúžení `mockPaymentsAllowed()` na `NODE_ENV==='test'` by zpřísnilo dle litery zadání, ale rozbilo by dev/staging demo; ponecháno jako samostatný krok, aby se v tomto kritickém kole nedestabilizoval vývoj. Reální fail-open webhooky (PayPal/Wise při nenastaveném secretu) jsou audit HIGH mimo K1–K3/V1.

---

## 4. Výsledky testů

| Sada | Výsledek |
|---|---|
| `tsc --noEmit` | **0 chyb** |
| Jednotková/komponentová sada (`vitest run`, jsdom) | **508 prošlo, 4 skip, 6 selhalo** — všech 6 je PŘEDEXISTUJÍCÍ (`subscriptions/checkout/route.test.ts`, audit N3; těch souborů jsem se nedotkl). Žádná nová regrese. |
| Fix regresní sada (`FIX_E2E=1`, izolovaná DB): V1+K1+K2+K3+sken | **18 / 18 prošlo** (5 souborů) |

**Regresní E2E scénáře z auditu proti přestavěnému fixnutému appu (HTTP, `next start` :3200):**
- setup rolí/akcí: `01` **26/0**.
- **nákup:** `02` P2a/P2b (checkout+cena), P5a (paid po webhooku), **P6 e-mail v Mailpitu** — PASS.
- **idempotence webhooku:** `02` P5b/P5c/P5e (3 webhooky → přesně N vstupenek, žádné dvojí vystavení), `05` C2a/C2c — PASS.
- **souběh 100 nákupů na 10 míst:** `05` C1a/C1b (přesně 10, žádný přeprodej) — PASS.
- **sken:** `tests/fix-regression-scan.live.test.ts` (platná → admitted, druhý sken → already_used, lístek `used`) — PASS.
- Navíc se díky opravám nově zelenají i přes HTTP: `02` P15a (cron expirace), `05` C5 (rate limit nákupu), `03` R1b (refund volá bránu).
- Zbývající FAIL v audit skriptech jsou PŘEDEXISTUJÍCÍ nálezy mimo toto kolo: P1 (`cart/validate`), P5d/C2b (triplikace `payment_events` = audit S1), P7d (PDF pod `tixly_app` = V2, příště), P13 (0 Kč lístek = V6), R1c (dotaz kontroly na neexistující `entity_id`). Řetěz `02→03` se navíc přetrhl jen proto, že audit skript (psaný před rate-limitem) hromadí >5 nezaplacených objednávek na jeden e-mail → nový per-e-mail limit je odmítne; není to produktová regrese.

---

## 5. Překryv se 104 necommitnutými cestami ve `tixly/` (nic nesloučeno)

Mnou změněných souborů: 25. Průnik s necommitnutými změnami v `tixly/`: **1 soubor — `nextjs-boilerplate/src/middleware.ts`.**
- **Moje změna:** přidání `/api/kiosk/` do `API_PROMOTER_PREFIXES`.
- **Necommitnutá změna uživatele (jiné hunky):** přidání `/api/offers/` do `PUBLIC_API_PREFIXES` a `/nabidka/` do frontend passthrough.
- Změny si **neodporují** (různé části souboru), ale jsou ve stejném souboru → při budoucím sladění je nutné je spojit **ručně. Nic jsem nesloučil** a do `tixly/` jsem nesáhl.

Ostatní mnou měněné soubory (24) se s necommitnutými změnami nepřekrývají. Seznam mnou měněných souborů:
```
migrations/472_refund_gateway_state.sql
src/app/api/admin/orders/[orderId]/refund/route.ts
src/app/api/auth/forgot-password/route.ts
src/app/api/buyer/orders/[orderId]/refund/route.ts
src/app/api/buyer/resale/buy/route.ts
src/app/api/buyer/tickets/[ticketId]/upgrade/route.ts
src/app/api/checkout/route.ts
src/app/api/internal/cron/expire-pending-orders/route.ts
src/app/api/kiosk/order/route.ts
src/app/api/payments/gopay/webhook/route.ts
src/app/api/subscriptions/holders/[paymentId]/confirm/route.ts
src/app/api/vouchers/holders/[paymentId]/confirm/route.ts
src/lib/orders/release-capacity.ts            (nový)
src/lib/payment/demo-path-guard.ts            (nový)
src/lib/payment/gateway-refund.ts             (nový)
src/lib/payment/gopay-real.ts
src/lib/payment/refund-order.ts               (nový)
src/middleware.ts                              ← PŘEKRYV
tests/fix-{v1,k1,k2,k3,regression-scan}.*.test.ts, tests/helpers/{local-fixture.ts,fake-gopay.mjs}  (nové)
```
(`nextjs-boilerplate/fix.app.env` je lokální běhový artefakt pro `next start` při regresi — necommitnuto.)

---

## 6. Poslední commit na větvi `fix/critical-2026-09-30`

**`f4ba019`**

Commity:
```
f4ba019 test(regression): sken u brany funguje po opravach
b17a9f7 fix(K1): vstupenky/hodnota bez platby — 5 cest uzavreno
99e9ac4 fix(K2): refund vola platebni branu (refunded az po potvrzeni)
269bb0f fix(K3): kapacita zamcena nezaplacenymi rezervacemi
d3380c7 fix(V1): reset hesla — forgot-password padal na 42703
```
