# TESTING_MAP.md — Model reality ticketingu Tixly

> **Účel:** přesný model reality (ne dojem z názvů souborů) pro tři věci — kdo co smí,
> jaké stavy a přechody objednávky/rezervace/lístku kód skutečně dovolí, a jaké
> doménové invarianty by měly platit. **Nic se tímto dokumentem nemění ani netestuje.**
>
> **Rozsah kódu:** aplikace `nextjs-boilerplate/` (jediná funkční app), migrace
> `nextjs-boilerplate/migrations/375–449`, a squashovaný baseline schématu
> `db/baseline.sql` (2026-06-01, 160 RLS policies, 152 tabulek s RLS). Peníze jsou
> v **haléřích** (minor units).
>
> **Legenda spolehlivosti:**
> - **[OVĚŘENO]** — přečten enforcing kód / SQL s citací `soubor:řádek`.
> - **[ODVOZENO]** — dedukce z okolního kódu, ne přímý běh.
> - **[MEZERA]** — invariant/kontrola, kterou se enforcement **nepodařilo najít** (klíčové zjištění).
>
> Metoda: statická analýza kódu a SQL (route guardy + `pg` RLS policies). Žádný běh proti DB.
> Runtime efekty (vs. GUC defaulty) nejsou spuštěny — kde na tom claim závisí, je to označeno.

---

## 0. Architektura autorizace v kostce (základ pro celý dokument)

Identita teče **výhradně** z JWT → middleware → hlavičky. Middleware
(`src/middleware.ts`) **na všech `/api/*` cestách nejdřív stripne** klientem
podvržené `x-user-id` / `x-is-admin` / `x-is-platform-admin` (`middleware.ts:98–101`),
ověří JWT (Bearer, fallback `accessToken` cookie) a teprve pak sám injektuje
`x-user-id` + `x-is-admin` (`:189–190`). Bez tohohle stripu by stačilo poslat
`x-user-id: <uuid-oběti>`. **[OVĚŘENO]**

Route handlery si z hlavičky `x-user-id` složí RLS kontext přes wrappery v
`src/lib/db/rls-pool.ts`, které na každý dotaz udělají `BEGIN; SET LOCAL app.* = …`:

| Session var | Nastavuje | Hodnoty |
|---|---|---|
| `app.current_promoter_id` | `runWithPromoterContext` (`rls-pool.ts:145,181`) | UUID promotéra |
| `app.current_user_id` | `runWithUserContext` (`rls-pool.ts:151,187`) | UUID uživatele |
| `app.is_platform_admin` | `runWithPlatformAdminContext` (`rls-pool.ts:148,184`) | `'true'` |
| `app.role` | všechny wrappery (`rls-pool.ts:154,190`) | `service`/`system`, `admin`, `gate`, `buyer`, `promoter`, `user` |

DB helper funkce (`db/baseline.sql:761,772`) čtou právě tyto vary: **[OVĚŘENO]**
```sql
app_current_promoter_id() = NULLIF(current_setting('app.current_promoter_id',true),'')::uuid
app_is_platform_admin()   = COALESCE(NULLIF(current_setting('app.is_platform_admin',true),''),'false')::boolean
```
Service/admin/gate se v policies testuje **inline** `current_setting('app.role',true) = ANY(ARRAY[...])`
— **funkce `app_is_service()` v baseline NEEXISTUJE** (proto pozor na migrace 375+, které ji volají, viz §4C).

**Klíčový fakt pro celý dokument:** DB policies rozlišují jen **promotér / uživatel /
platform-admin / service|admin|gate**. **Nerozlišují promotér-role owner vs staff vs
manager** — to je čistě aplikační vrstva (route guardy). **[OVĚŘENO]** — jediná
role-based predikát v celém baseline je `tickets_owner_isolation` (na `owner_id`, ne na promotér-roli).

---

## 1. ROLE — kdo co SMÍ (ze zdroje: route guardy + DB policies)

### 1.1 Přehled aktérů a jak se autentizují

| Aktér | Autentizace | Definováno / vynuceno v |
|---|---|---|
| **Platform admin** (provozovatel) | JWT `roles.isPlatformAdmin=true` | `platform-auth.ts`; middleware prefix `/api/platform/` (`middleware.ts:60,172`). DB: `identity.users.is_platform_admin` (bool, **ne** role-řádek). RLS bypass přes policy `app_is_platform_admin()`. |
| **Promotér – member** | JWT + `x-user-id`; role/status z `platform.promoter_members` | `admin-auth.ts`; middleware prefixy `/api/admin/`, `/api/orders/` (`:59`). |
| **Kupující / user** | JWT → `x-user-id` | `auth.ts runAsUser`; middleware `API_OPTIONAL_AUTH_PREFIXES` (`:64`). RLS přes `app.current_user_id`. |
| **B2B partner (API klíč)** | Bearer `tick_test_*` / `tick_live_*`, SHA-256, `b2b.api_keys` | `b2b-auth.ts:32,57–62`. Scope[] + rate limit, **bez user identity**, scoped na promotéra. Fail-closed. |
| **Reseller** | Bearer reseller-JWT (vlastní `RESELLER_JWT_SECRET`) | `reseller-auth.ts:17,38–44`; `platform.reseller_partners` (bcrypt, nutný `status='active'`). Middleware pouští `/api/reseller/` jako **PUBLIC** (`:75`) → route se hlídá sama. |
| **OAuth app / API v3 klient** | Bearer `tk_*` + scopes, `b2b.oauth_access_tokens` | `oauth/flow.ts:22,276`, `oauth/guard.ts:24`. `requireApiAuth` bere `tk_*` i `tick_*`, kontroluje `requiredScope` (`*` = wildcard). PKCE S256. **Nese scopes, ne role.** |
| **Nákupní AI agent (C8 „Agent Lane")** | hlavička `x-agent-key`, hash → `platform.purchase_agents.api_key_hash` | `agent/purchase-intent/route.ts:25`; nutný `status='active'`, vázán na `owner_user_id`, gate přes `platform.agent_mandates` (`lib/agents/mandate.ts checkMandate`). Registruje ho ověřený user (`buyer/agents/register/route.ts:14`). |
| **Scanner (in-app)** | JWT promotéra (`runAsActivePromoter`) | `admin/scanner/validate/route.ts:65`; vlastnictví lístku per-ticket (`event_promoter_id !== promoterId → 403`, `:122`). |
| **Scanner (HW turniket)** | `X-Device-Key: tixly_dev_*` → `catalog.scanner_devices` | `hardware/scan/route.ts:61–99` (device-key, **bez JWT/usera**). Klíč vytvoří `runAsActivePromoter`. |
| **RFID čtečka** | `X-Device-Key: tixly_rfid_*` → `catalog.rfid_devices` | `rfid/scan/route.ts:57–88`. |
| **Interní cron / service** | `x-internal-token == INTERNAL_SERVICE_TOKEN` (constant-time) | `internal/cron/*/route.ts:27–29`; middleware `/api/internal/` PUBLIC (`:75`). Běží v `runWithServiceContext` (RLS = plný přístup přes `app.role IN (service,system)`). |
| **Sociální login (google/apple/facebook)** | vytvoří **normální buyer JWT** | `oauth/provider.ts` → `signAccessToken`. **Není samostatná role** — kolabuje do kupujícího. |

### 1.2 Promotér-role: co říká kód vs. co říká DB

- **Route guardy rozlišují jen tři stavy role:** `owner`, `staff`, „ne-staff" —
  literály v `admin-auth.ts:90,101,112,123`. Guardy + počty výskytů (`src/app/api`): **[OVĚŘENO]**

  | Guard | Kdo projde | Výskytů | Souborů |
  |---|---|---|---|
  | `runAsPromoter` | libovolný member, libovolný status | 190 | 122 |
  | `runAsActivePromoter` | member, `status=active` | 182 | 137 |
  | `runAsPromoterNonStaff` | role ≠ `staff` | 55 | 43 |
  | `runAsActivePromoterNonStaff` | active + role ≠ `staff` | 12 | 12 |
  | `runAsPromoterOwner` | role = `owner` | 14 | 9 |
  | `runAsActivePromoterOwner` | active + role = `owner` | 6 | 6 |
  | `runAsPlatformAdmin`/`requirePlatformAdmin` | platform admin | 85 | 58 |

  - **Owner-only** (finance/identita/konfig): `admin/team` (POST invite `:85`), `admin/staff`,
    `admin/subscription-plans`, `admin/branding`, `admin/kyc`, `admin/domains`,
    `admin/events/[id]/lotteries/[lotteryId]/draw`, `admin/cross-passes`.
  - **Non-staff** (manager+): `admin/settings`, `admin/invoices`, `admin/payouts(/settle/export)`,
    `admin/webhooks`, `admin/oauth-apps`, `admin/accounting/export`, `admin/chargebacks`,
    `admin/bank-transfers/reconcile`, `admin/events/[id]/advance-payout`, `admin/member-groups`.
  - **Active-promoter (i staff smí)**: `admin/scanner/validate`, `admin/pos/sale`,
    `admin/events/[id]/box-office/*`, `admin/events/[id]/guestlist/checkin`, většina event-ops.

- **Bohatší role existují jen jako data, ne jako pravidlo.** Invite Zod schéma
  (`admin/team/route.ts:72–81`) enumeruje `admin, manager, finance, marketing, staff,
  gate, box_office, accreditation_manager` (+ `owner` = zakladatel). **Žádný guard na
  tyto hodnoty nevětví** (grep = 0 branchí mimo invite UI) a **neexistuje DB CHECK/enum**
  na `promoter_members.role` v tomto stromu migrací. Důsledek: člen s rolí `gate` nebo
  `box_office` má **stejnou API pravomoc jako `manager`** (vše kromě owner/non-staff bran).
  **[OVĚŘENO — absence]**

- **Na úrovni DB role promotéra vůbec nefiguruje.** Každá promotér-policy je tvaru
  `app_is_platform_admin() OR promoter_id = app_current_promoter_id()` (viz §4).
  Owner/staff distinkce **žije 100 % v route guardech** — kdo obejde route vrstvu
  a mluví s DB v promotér-kontextu, má práva celého promotéra bez ohledu na roli. **[OVĚŘENO]**

---

## 2. STAVOVÉ AUTOMATY (stavy + přechody skutečně povolené v kódu)

Dva strukturální fakty předem:
- **Dva modely sedaček.** Golden path používá `catalog.event_seats`
  (`available|held|sold|blocked`, `baseline.sql:2922`). Paralelní legacy
  `catalog.seats` (`available|locked|sold|blocked`, `baseline.sql:3857`) **golden path
  nepoužívá.** **[OVĚŘENO]**
- **„Rezervace" není jedna tabulka.** Buyer hold = `event_seats` (per-sedadlo) +
  `orders.orders.expires_at` (TTL). `seat_holds.seat_holds` (`baseline.sql:11206`) je
  jiný koncept (admin/produkční kill) a **nemá status sloupec** (jen `released_at`,
  `hold_type ∈ hold|kill`). Schéma `reservations.*` je samostatný rezervační modul
  (bookings/services), ne prodej lístků.

### 2.1 OBJEDNÁVKA — `orders.orders.status`

`CHECK IN ('pending','paid','paid_partial','cancelled','refunded','expired','chargeback')`
(`baseline.sql:1508`) **[OVĚŘENO]**. Sekundární `cancellation_refund_status ∈
{NULL,no_refund,pending,approved,completed,rejected}` (`baseline.sql:1503`).

```
   checkout POST  (INSERT status='pending', expires_at = now()+15min | +3 dny bank_transfer)
        │
        ▼
    ┌── pending ─────────────────────────────────────────────┐
    │      │            │                    │                │
 provider provider   expire-cron        fraud='block'         │
 'pay'    'cancel'   (status=pending,    → ROLLBACK           │
 (FOR      │          expires_at<now)    (nikdy necommitne)   │
 UPDATE,   │             │                                    │
 status=   ▼             ▼                                    │
 pending)  cancelled   expired                                │
    │      (+restore    (+restore remaining_qty,              │
    │       qty+seats)   release seats)                       │
    ▼                                                         │
 paid ── nebo ── paid_partial (má aktivní payment_plan          │
    │             s pending splátkami)                         │
    │                                                         │
    ├── refunded  (admin/buyer refund; JEN ze stavu 'paid')    │
    └── cancelled (buyer cancel z paid/paid_partial) ──────────┘

 chargeback: v enumu, ale ŽÁDNÝ kód ho nenastaví → mrtvý stav
```

Přechody (**[OVĚŘENO]**):
- `∅ → pending`: `checkout/route.ts:1608–1620` (literál `'pending'`; `expires_at` `:1591`).
  Cesta `b2b_credit` přepne na `paid` ještě před COMMIT (`:2094`).
- `pending → paid | paid_partial`: `mock-gopay/[paymentId]/route.ts:74–80`. **Guard:**
  `FOR UPDATE` + `if status !== 'pending' return current` (`:42`). `paid_partial` jen když
  existuje `orders.order_payment_plans` `active` s pending splátkou (`:64–72`). **Stejný
  guardovaný vzor** ve všech branách: `mock-przelewy24 :48,67`, `mock-crypto :95`,
  `mock-bnpl/.../confirm :86`, `payments/triplea/webhook :121`, `payments/wise/webhook :81`,
  `admin/bank-transfers/reconcile :94`, `mobile/order-confirm :82`.
- `pending → cancelled`: provider `action:'cancel'` (`mock-gopay :47–53`, guard status=pending).
- `pending → expired`: cron `internal/cron/expire-pending-orders/route.ts:41–58`
  (`WHERE status='pending' AND expires_at<now() FOR UPDATE`; + restore `remaining_qty` `:61`,
  release seats `:75`).
- `paid → refunded`: admin `admin/orders/[orderId]/refund/route.ts:164` (guard `status==='paid'`
  `:155`; idempotentní short-circuit na už-`refunded` `:147`). Buyer
  `buyer/orders/[orderId]/refund/route.ts:247`. Approval `admin/refund-requests/[id]/route.ts:144`.
- `{pending,paid,paid_partial} → cancelled`: `buyer/orders/[orderId]/cancel/route.ts:102–104`
  (whitelist `:82`, už-cancelled → 409 `:78`).

Mrtvé konce / poznámky:
- **`paid_partial` nelze refundovat** — oba refund endpointy guardí přesně `status==='paid'`
  (admin `:155`, buyer `:79`). Částečně placená objednávka jde jen `cancelled`. **[OVĚŘENO]**
- **Žádný přechod `paid_partial → paid`** po doplacení poslední splátky (grep 0 setterů). **[OVĚŘENO — absence]**
- **`chargeback`** deklarován, nikdy nezapsán. **[OVĚŘENO — absence]**

### 2.2 SEDADLO / INVENTÁŘ — `catalog.event_seats.status`

`available | held | sold | blocked` (`baseline.sql:2922`); `hold_kind ∈
{artist,promoter,comp,production,customer}`, `hold_until` TTL.

```
       ┌──────────── available ◄───────────────────────────┐
       │                ▲    ▲                              │
 hold POST              │    │ release-expired-seat-holds   │ expire-pending-orders
 (FOR UPDATE, TTL 15m)  │    │ cron (hold_until<now)        │ / refund / cancel
       ▼                │    │ hold DELETE (holdToken)      │ (order_id→NULL)
      held ─────────────┘    │                              │
       │                     │                              │
   checkout COMMIT           │                              │
   (status='sold',           │                              │
    hold_until=NULL,         │                              │
    order_id set)            │                              │
       ▼                     │                              │
      sold ──────────────────┴──────────────────────────────┘   (zpět na available při expiry/refund/cancel)

 blocked: admin-set, buyer flow se ho nedotkne
```

Přechody **[OVĚŘENO]**: `available→held` `seats/hold/route.ts:138–157` (`FOR UPDATE` `:107`,
odmítne ne-`available` pokud hold nevypršel `:120–122`, `hold_until=now+15m` `:19`);
`held→available` (self-cleanup `:86–99`, explicit DELETE `:194–198`, TTL sweep
`internal/cron/release-expired-seat-holds/route.ts:38–48`); `held→sold` v COMMIT checkoutu
`checkout/route.ts:1858–1864` (před tím re-validace pod `FOR UPDATE`, odmítne `status!='held'`
`:675` nebo expirovaný `hold_until` `:688–691`); `sold→available` při expired/refund/cancel.

### 2.3 LÍSTEK — `tickets.tickets.status`

`valid | used | revoked | transferred | resale_listed` (`baseline.sql:9886`). Oddělené
sloupce: `transfer_status ∈ {NULL,pending_transfer,transferred}` (mig `416:27`),
`phone_change_review_status ∈ {NULL,pending,approved,rejected}` (`baseline.sql:9885`).

```
        issueTicketsForOrder (INSERT status='valid')
                     │
                     ▼
     ┌───────────── valid ─────────────────┐
     │       │            │                 │
 scan/       │       transfer (výměna       │ refund/cancel
 validate    │       owner_id, status       │
 (vstup)     │       zůstává 'valid')       ▼
     ▼       │                            revoked
    used     │                            (revoked_at)
 (used_at,   └── re-entry: scan_count±, currently_inside
  currently_     (status zůstává 'used')
  inside)
     ▼  (terminál pro vstup)

 resale_listed / transferred: v CHECK, ale NIKDY nezapsané kódem → mrtvé stavy
```

Přechody **[OVĚŘENO]**: `∅→valid` `lib/tickets/demo-issuer.ts:141` (z `internal/order-completed:409`);
`valid→used` scannery `admin/scanner/validate:367,386`, `validate-nfc:120`, `validate-group:84`,
`hardware/scan:186`, `guestlist/checkin:87` (re-entry `scanner/reentry:169,209` mění jen
`currently_inside`/`scan_count`); `valid→revoked` buyer cancel `:118–121`, admin refund
`:171–175`, buyer refund `:199,253`, approval `:111,149`. **Mrtvé stavy** `resale_listed`
(resale drží lístek `valid`) a `transferred` (P2P jede přes `transfer_status`) — nikdy nezapsané. **[OVĚŘENO — absence]**

### 2.4 REFUND — rozprostřený přes TŘI tabulky/sloupce (žádný jediný automat)

- **`orders.refund_requests.status`** `CHECK IN ('pending','approved','rejected','cancelled','escalated')`
  (`baseline.sql:7655`). V kódu dosažitelné jen `pending → approved`
  (`admin/refund-requests/[id]:174`, + revoke lístků, order→refunded, restore qty/seats) a
  `pending → rejected` (`:73`). `cancelled`/`escalated` — bez setteru. **[ODVOZENO — mrtvé]**
- **`public.refunds.status`** `CHECK IN ('pending','completed','failed')` (`baseline.sql:9339`) —
  gateway-refund ledger; přechody na `completed/failed` v hlavním API stromu nenalezeny. **[ODVOZENO]**
- **`orders.orders.cancellation_refund_status`** (`baseline.sql:1503`) — buyer cancel nastaví
  `'pending'` nebo `'no_refund'` (`cancel/route.ts:112`); dál nikdo neposune. **[ODVOZENO — mrtvý konec]**

### 2.5 TRANSFER — TŘI paralelní mechanismy

- **(a) Přímý buyer transfer** `buyer/tickets/[ticketId]/transfer/route.ts` — vymění `owner_id`
  in-place, `transfer_count++`, smaže `device_binding_id` (`:213–219`), **žádný transfer-řádek**
  (jen audit). Guardy: owner==user (`:145`), ticket `valid` (`:152`), order `paid` (`:159`),
  `transfer_policy != 'disabled'` a `< max_transfer_count` u `restricted` (`:165–186`), ne-sobě (`:188`). **[OVĚŘENO]**
- **(b) P2P pozvánka** `orders.ticket_transfers` (status `pending|claimed|cancelled|expired`,
  mig `416:13–14`): `pending → claimed` na accept (`tickets/transfer/[token]:102–103`,
  + `transfer_status='transferred'`, `owner_id=recipient`). Guardy: `status='pending'` `:72`,
  ne-expirovaný `:76`, email claimanta == `to_email` `:86`. **[OVĚŘENO]**
- **(c) Resale marketplace** `resale.resale_listings` (`active|reserved|sold|cancelled`):
  `active→reserved` (`resale/purchase/[listingId]:78`), `reserved→sold`
  (`internal/resale/complete-transfer:86–93`, guard listing `status='reserved'`). **[OVĚŘENO]**

### 2.6 PLATBA — není jediný status sloupec

Modelováno jako: append-only `orders.payment_events` (**bez** status, `baseline.sql:7534`,
zapisuje `PAID/PAID_PARTIAL/CANCELED`), efektivní výsledek nese `orders.status`,
`orders.order_payment_plans.status ∈ {active,completed,defaulted,cancelled}` (`baseline.sql:7526`),
`orders.payment_installments.status ∈ {pending,paid,failed,skipped}` (`baseline.sql:7618`),
`benefit_payments.payment_sessions.status ∈ {initiated,pending_user_auth,authorized,captured,failed,refunded}`
(`baseline.sql:2349`). Gateway-redirect fáze nemá vlastní DB stav (jen `orders.status='pending'` + `gopay_payment_id`).

### 2.7 GOLDEN PATH — přesné stavy v každém kroku **[OVĚŘENO]**

1. Výběr sedadla → `event_seats: available → held` (`hold_until=now+15m`), vrací `holdToken`.
2. Checkout POST → `orders.status='pending'` (`expires_at=now+15m`), seats `held→sold` v COMMIT,
   `ticket_types.remaining_qty -= qty` (atomicky `checkout/route.ts:1887`). **Zatím žádné lístky.** Vrací `gatewayUrl`.
3. Platba u brány → `mock-gopay {action:'pay'}` → `orders: pending → paid` (`paid_at=now`, `payment_events += PAID`).
4. Fire-and-forget → `internal/order-completed` → `issueTicketsForOrder` → `tickets.status='valid'`
   (idempotentní read-check), e-mail/PDF/wallet, loyalty, potvrzení addonů/travel/party-split.
5. U vstupu → scanner `tickets: valid → used`.
6. Opuštění: order zůstane `pending` do `expires_at`; cron `pending → expired`, restore qty, seats → available.

---

## 3. DOMÉNOVÉ INVARIANTY (co by MĚLO platit) + kde je enforcement

Legenda enforcementu: **DB** = constraint/trigger, **APP** = aplikační kód, **NIKDE**.

### Jádro

1. **Žádný oversell GA inventáře.** Pro každý `ticket_type`: `remaining_qty >= 0` a checkout
   projde jen když `remaining_qty >= qty`. **DB + APP.** Atomický podmíněný UPDATE
   `checkout/route.ts:1887–1900` (`... WHERE id=$2 AND remaining_qty >= $1 RETURNING`;
   `rowCount===0 → ROLLBACK + 409`). Backstop `baseline.sql:3591` `CHECK (remaining_qty >= 0)`
   a `:3585` `CHECK (remaining_qty <= total_qty)`. **[OVĚŘENO]**
2. **Sedadlo prodáno max 1× per event.** `available→held→sold` pod `FOR UPDATE`
   (`seats/hold:103–157`, checkout re-lock `:655–682`, flip `:1858–1864`). DB backstop je jen
   `UNIQUE(event_id,event_day_id,sector,row,seat_number)` (`baseline.sql:14607`) na duplicitní
   *řádek sedadla* — **NE** partial-unique na „jeden `sold` na sedadlo". Unikátnost *prodeje*
   je čistě APP (row lock). **[OVĚŘENO]**
3. **Lístek lze uplatnit (scan) max 1×.** `valid→used` pod `SELECT ... FOR UPDATE OF t`
   + status gate (`admin/scanner/validate:92–204,386`; multi-day přes `ticket_redemptions`
   `:286–299`). **APP.** **[OVĚŘENO]**
4. **Vydání lístků po platbě je idempotentní.** Dvě vrstvy: (a) platba je idempotentní přes
   podmíněný UPDATE `... WHERE status='pending' RETURNING` (`payments/gopay/webhook:121–130`;
   stejně comgate/mollie/stripe/paypal/przelewy24) → `order-completed` fires jen 1×; (b)
   `order-completed` guardí `status==='paid'` (`internal/order-completed:324`) a issuer
   read-checkuje existující lístky (`demo-issuer.ts:63–80`). **APP.** ⚠️ **Idempotence issuance
   je jen read-then-write** — **žádný `UNIQUE(tickets.order_id)`**, žádný order-level lock;
   dvě *souběžné* invokace `order-completed` by teoreticky mohly dvakrát vložit. Single-fire
   webhook to v praxi tlumí, ale invariant není tvrdě vynucen. **[OVĚŘENO / ODVOZENO-slabé]**
5. **Peníze: `total >= 0`, refund ≤ zaplaceno.** **DB** `baseline.sql:1509` `CHECK(total_amount>=0)`,
   `:1505` `discount_halire>=0` + plošné `>=0` na fees/pricing. **APP** admin refund jen full &
   jen z `paid` (`refund/route.ts:155–167`, `FOR UPDATE OF o` `:133`). **[OVĚŘENO]**
   - **[MEZERA]** *order total == Σ(order_items)* **NIKDE** — žádný trigger/constraint neváže
     `total_amount` na `SUM(order_items.total_price)`; věří se APP aritmetice.
   - **[MEZERA]** admin refund revokuje lístky `WHERE status <> 'revoked'` (`refund:171–179`)
     — **refundne i už-`used` (proskenované) lístky**; žádný „po vstupu nerefundovat" guard.

### Nákup / limity

6. **Per-buyer purchase limits (mig 433).** Tři stropy: `events.max_tickets_per_buyer`,
   `ticket_types.max_per_buyer`, legacy `max_per_user`; počítá `pending`+`paid` podle `user_id`
   NEBO `buyer_email`. **APP only** `checkout/route.ts:887–961` (`SUM(quantity) ... → 422`).
   Migrace 433 přidává jen sloupce, **žádný DB constraint**. **[MEZERA/RACY]** — count-then-check
   bez zámku nad předchozími objednávkami; dva souběžné checkouty téhož kupce mohou strop překročit. **[OVĚŘENO]**

### Transfer / resale

7. **Transferovat smí jen owner, ne `used`/`revoked` lístek.** **APP** initiace
   `buyer/tickets/[ticketId]/transfer-invite:43` (`owner_id=$2 AND status='valid'`), accept
   `transfer/accept/[token]:100–141` (`FOR UPDATE`, `pending`, ne-expirovaný, ne-sobě, email match,
   rewrite `WHERE status='valid'`). **[OVĚŘENO]** Drobná vada: pokud lístek už není `valid`,
   ownership UPDATE je tichý no-op, ale pozvánka se přesto označí `accepted` (`:149–154`).
8. **Resale cenový strop ≤ face value (mig 404/438/445).** **DB + APP** `baseline.sql:9620`
   `CHECK(ask_price <= original_price)` (+ `:9622,:9623`), APP `buyer/resale/list:147–157`
   (`PRICE_CAP_BPS=10000`), lock `FOR UPDATE SKIP LOCKED` + `status='active'`
   (`resale/purchase/[listingId]:37`). **[OVĚŘENO]**
9. **No-surge pledge — dynamické ceny jen dolů.** **APP** `lib/pricing/dynamic-engine.ts:228–264`
   (`no_surge_pledge` → `noSurge` do `evaluateRules`). Interní logika `evaluateRules` nedočtena — cap **[ODVOZENO]**.

### Temporální / vstupní brány

10. **Seat holdy expirují a uvolní inventář.** **APP** TTL 15 min (`seats/hold:19,135`),
    checkout odmítne expirovaný hold (`checkout:687–701`), nezávisle na release cronu. **[OVĚŘENO]**
11. **Presale / Verified-Fan / queue brány.** **APP** presale okno+kód `checkout:424–439`;
    VF `:354–392` (`FOR UPDATE`, single-use `used_order_id IS NULL`); queue token `:589–626`
    (`admitted`, ne-expirovaný); timed-entry sloty `:525–563`. **[OVĚŘENO]** Pozn.: VF kód
    není vázán na uživatele (TODO v kódu `:387`) — kód lze sdílet.
12. **Prodej jen u `published` eventu.** **APP** `checkout:334` (`e.status='published'`). **[OVĚŘENO]**
    - **[MEZERA]** **žádný cutoff na skončený/uzavřený prodej** — v checkoutu není `date_start<NOW()`
      ani sales-window guard; nákup není časově omezen nad rámec `published` + inventáře.

### Uložená hodnota / finance

13. **Dárkové karty & vouchery: nezáporný zůstatek, žádné dvojité utracení.** **DB**
    `baseline.sql:6437` `CHECK(balance_halire>=0)`, `:6435` `CHECK(balance<=amount)` (+ RFID/wristband/credit
    `>=0`). **APP** `Math.min(remaining,total)` pod `FOR UPDATE` (`checkout:1455–1490,2007–2011`;
    voucher `:1446–1448`; restwert FIFO `:1508–1531`). **[OVĚŘENO]**
14. **Payout / provize.** **APP** `admin/payouts/route.ts:169–172`
    (`fees=floor(gross*feeBps/10000)`, `net=max(0, gross-refunds-chargebacks-fees-holdback)`;
    default `PLATFORM_FEE_BPS=500` = **5 %** `:13`, per-currency override `fee_schedules` `:89–102`;
    gross vylučuje `service_fee_minor`). Holdback `lib/payouts/holdback.ts:25–27`. **[OVĚŘENO]**
    Pozn.: default v kódu je **5 %**, ne 2,5–3 % z paměti projektu — nižší sazba je per-promotér override.

---

## 4. KDE se autorizace vynucuje: ROUTE GUARD vs DB (RLS) vs NIKDE

### 4A. Vrstvy — jak se skládají

Na core ticketing tabulkách běží **obojí** (defense-in-depth): middleware prefix gate →
route guard (role/status) → RLS policy (tenant/owner izolace). Na některých feature
tabulkách běží **jen route guard** (RLS mrtvá, viz 4C) nebo **jen middleware**.

### 4B. Core tabulky — RLS je ZAPNUTÁ a správně klíčovaná (ověřeno v `db/baseline.sql`)

| Tabulka | RLS enabled | Klíčová policy (USING) | Kdo vidí |
|---|---|---|---|
| `catalog.events` | `:31282` | `app_is_platform_admin() OR promoter_id=app_current_promoter_id() OR status='published'` (`:31346`) | admin, vlastník-promotér, **+ veřejnost pokud published** |
| `catalog.ticket_types` | `:31412` | admin OR `EXISTS(event … promoter)` (`:31384`) | admin, vlastník-promotér (přes event) |
| `orders.orders` | `:31870` | `orders_user_isolation`: `user_id=app.current_user_id` (`:31883`) + `orders_service_full_access`: `app.role IN (service,admin)` (`:31876`) | kupující svoje, service/admin vše |
| `tickets.tickets` | `:32913` | `tickets_owner_isolation`: `owner_id=app.current_user_id` (`:32919`) + `tickets_service_full_access`: `app.role IN (service,admin,gate)` (`:32926`) | vlastník svoje, service/admin/**gate** vše |
| `orders.refund_requests` | `:31925` | admin OR `promoter_id=app_current_promoter_id()` (`:31918`) | admin, promotér |
| `platform.payouts` | `:32126` | (promotér přes join) | promotér |

**Promotér-policies napříč `catalog/orders/public/reservations`** mají jednotný tvar
`app_is_platform_admin() OR promoter_id=app_current_promoter_id() [OR promoter_id IS NULL]`
(desítky výskytů `:31304–32638`). **Nerozlišují promotér-roli** → viz §1.2. **[OVĚŘENO]**

**Public-read fallback** (viditelné bez kontextu): `catalog.events` když `status='published'`
(`:31346`); v migracích 375+ dále `seat_view_photos`, `travel_*`, `superfan_experiences`,
`parking/accommodation_offers` (`active=true`), `carbon_offset_settings`, `postal_fees`,
`party_split_sessions` (`status='open'`), `lineups.artists` (`public=true`). **[OVĚŘENO]**

### 4C. Tabulky, kde RLS NENÍ nebo je MRTVÁ (spoléhá se jen na app vrstvu)

- **Bez jakékoli RLS (jen app-layer):** **[OVĚŘENO]**
  - `catalog.event_seats` — **žádná policy, RLS neenabled** (přestože je to jádro holdu/prodeje).
    Izolace stojí čistě na app SQL + join přes event.
  - `orders.order_items` — **žádná policy, RLS neenabled.**
  - `platform.purchase_agents`, `platform.agent_mandates` (mig `449:12,24`) — **žádná RLS**
    (mandáty AI nákupních agentů nechráněné na DB úrovni).
- **Systematický name-drift → mrtvé predikáty (migrace 375–449).** Feature migrace klíčují
  policies na varnames, které app **nikdy nenastaví** (`app.promoter_id`, `app.user_id`,
  `app.is_service`, `app.bypass_rls`, `app.use_service_role` místo kanonických
  `app.current_*` / `app.role`) — a volají `app_is_service()`, **která v baseline neexistuje**.
  Protože RLS policies jsou PERMISSIVE (OR), predikát na neexistující var → false → tichá blokace.
  **[OVĚŘENO — mismatch proti `rls-pool.ts`; runtime efekt neproběhl, hedged]**
  - **Plně zamčené** (jediná cesta přes rozbitý var): `catalog.event_distribution_partners`
    (mig 385/385b), `orders.resale_listings` (404), `lineups.royalty_*` (403),
    `platform.qes_signing_requests` (401), `catalog.rfid_*` (400), `orders.bundle_items` (402).
  - **Buyer/promotér větev mrtvá, admin funguje:** `orders.ticket_transfers` (416),
    `orders.travel_bookings` (414), `orders.box_office_*` (415), `orders.postal_deliveries` (418),
    `orders.seat_upgrades` (420), `catalog.event_sponsors`/`event_travel_links` (383).
  - **Over-exposure:** `marketing.ticket_alerts` (mig `417:25–29`) — větev
    `current_setting('app.user_id',true) = ''` → když není user kontext, **čitelné všechno**.
  - **Supabase-ismus (pravděpodobně nefunkční):** `platform.vies_checks` (mig `390:35–37`)
    používá `auth.uid()` / role `authenticated` / `platform.users_promoters` — cizí Neon/pg appce.

### 4D. Route handlery BEZ guard importu (spoléhají na middleware prefix / vlastní check / nic)

Z 698 `route.ts` **254 neimportuje** žádný guard modul. Rozpad: **[OVĚŘENO]**
- **Legitimně chráněné jinak:** `internal/cron/**` (33× `x-internal-token`), device-key
  (`hardware/scan`, `rfid/scan`, `v3/secure-entry/barcode`), agent lane (`agent/purchase-intent`
  `x-agent-key`), `platform/partners` (`x-internal-token`), inline `x-user-id` checky
  (`orders/route.ts:11`, `admin/orders/route.ts:66`, `admin/payouts/execute/route.ts:19`).
- **Legitimně veřejné** (middleware PUBLIC/PUBLIC_GET): `public/events/**`, `search`,
  `subscriptions/plans`, `v1/feed/**`, `editorial/**`, OAuth callbacky, payment mocky/webhooky.
- **Pozor (code-evident, runtime neověřeno):**
  - `admin/gift-cards/route.ts:10–12` gate na `x-is-platform-admin==='true'`, ale **middleware
    tuhle hlavičku nikdy nenastaví a naopak ji stripuje** (`middleware.ts:101`; nastavuje jen
    `x-is-admin` `:190`) → route je **fail-closed mrtvá (vždy 403)**. Latentní bug, ne díra.
  - Odguardované `admin/*` + `platform/*` routy sedí za middleware prefix gatem, ale
    **nenastavují per-promotér RLS kontext helperem** → cross-tenant izolace závisí na jejich
    vlastním inline SQL / `runWithServiceContext` (kandidát na IDOR review; mimo rozsah, neověřeno).

---

## 5. Souhrn nejdůležitějších zjištění (jen pozorování — nic se neopravuje)

1. **Owner/staff role neexistuje v DB** — vynucení je 100 % v route guardech; bohatší role
   (`gate`,`box_office`,`finance`,`marketing`,`accreditation_manager`) jsou data bez pravidla. (§1.2)
2. **`event_seats` a `order_items` nemají RLS** — jádro prodeje chráněné jen app vrstvou. (§4C)
3. **Name-drift v migracích 375+** nechal ~15 feature tabulek s mrtvou promotér/buyer/service
   RLS; `ticket_alerts` je naopak over-exposed; agent-lane tabulky bez RLS. (§4C)
4. **Idempotence vydání lístků** je jen read-then-write (bez `UNIQUE(tickets.order_id)`/zámku). (§3.4)
5. **Purchase limits jsou racy** (count-then-check bez zámku, jen app). (§3.6)
6. **`order.total == Σ(order_items)` nikde nevynuceno.** (§3.5)
7. **Refund umí revoke i `used` lístku**; **nákup nemá časový cutoff** na skončený prodej. (§3.5, §3.12)
8. **`paid_partial` je nerefundovatelný** mrtvý konec; **`chargeback`/`resale_listed`/`transferred`
   jsou mrtvé stavy** bez setteru. (§2.1, §2.3)
9. **Buyer-cancel refund_request INSERT je rozbitý** (chybný sloupec `amount_halire`, chybí
   NOT NULL `user_id`) a **tiše spolknutý `.catch`** → owed refund existuje jen jako flag na
   objednávce, nikdy nevznikne worklist řádek. (přílohové zjištění state-machine analýzy, §2.4)

*Pozn. k důkazní síle:* §1, §2, §3 stojí na přečteném kódu/SQL (citace `soubor:řádek`).
RLS efekty v §4 jsou z definic policies + kanonických varnamů v `rls-pool.ts`; **runtime
`pg_policies` dump ani živý dotaz neproběhl** (task = jen mapa), takže „mrtvá policy"
zjištění jsou definitivní na úrovni mismatchu, ale ne potvrzená živým během.
