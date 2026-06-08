# RLS Fáze 2 — enforce tenant izolace (větev `feature/rls-phase2-enforcement`)

Navazuje na Fázi 1 (app už běží jako non-superuser `tixly_app`, viz `security-rls-report.md`).
Cíl Fáze 2: zapnout vynucení RLS (`ALTER ROLE tixly_app NOBYPASSRLS`), aby tenant izolace
měla DB-level záchrannou síť, ne jen app-layer `WHERE`.

## ✅ Ověřeno na této větvi: enforce RLS funguje (PoC)

Test role `tixly_rls_test` (NOBYPASSRLS, dědí granty tixly_app) proti seedovaným datům.
Ground truth: 10 events (8 published), promotér 111 má 3 (vše published), promotér 112 má
pending event 407; buyer 600 a 601 mají po 4 objednávkách.

| Kontext (SET app.*) | catalog.events | orders.orders | Závěr |
|---|---|---|---|
| žádný (anon) | 8 (jen published) | 0 | ✓ veřejné jen published, cizí orders skryté |
| `current_promoter_id=112` | 9 (8 + vlastní pending 407) | — | ✓ vidí svůj pending |
| `current_promoter_id=111` | 8 (407 **nevidí**) | — | ✓ NEvidí cizí pending |
| `current_user_id=600` | — | 4 (jen 600) | ✓ buyer izolace |
| `current_user_id=601` | — | 4 (jen 601) | ✓ navzájem se nevidí |
| `is_platform_admin=true` | 10 (vše) | — | ✓ admin plný přístup |

→ **Policy vrstva i NOBYPASSRLS role fungují.** Co chybí k produkčnímu zapnutí, je níže.

## 🚧 Blokery zapnutí (musí být hotové PŘED `NOBYPASSRLS`)

### 1. Nekonzistentní context kontrakt (NUTNO sjednotit)
Existujících 160 policy používá **tři různé konvence** session proměnných:

| Vzor | Tabulky | Proměnné |
|---|---|---|
| promoter-scope | catalog.events, ticket_types | `app.current_promoter_id` + `app.is_platform_admin` (přes `app_current_promoter_id()` / `app_is_platform_admin()`) |
| user-scope | orders.orders, tickets.tickets | `app.current_user_id` + `app.role IN (service,admin,gate)` |
| tenant-scope | platform.promoters | `app.tenant_id` + `app.role` |

`src/lib/db/rls-pool.ts` historicky nastavoval jen `current_promoter_id` + `is_platform_admin`
→ orders/tickets/promoters policy by pod enforce vrátily 0 řádků.

**✅ HOTOVO (krok 1 — kanonický kontrakt):** `migrations/330_rls_canonical_contract.sql` zavádí
4 helpery (`app_current_user_id`, `app_current_promoter_id`, `app_is_platform_admin`, `app_is_service`)
a sjednocuje golden-path policy (events, ticket_types, event_seats, orders, order_items, tickets)
na model `admin || service || vlastník || promotér-akce || public-published`. Ověřeno přes
`tixly_rls_test`: anon→jen published/0; buyer 600→4 orders/4 items/6 tickets; buyer 601→4 (≠600);
promotér 111→11 orders (akce promotéra); service/admin→21 (vše). Izolace sedí napříč tabulkami.

**✅ HOTOVO (krok 2 — wrapper trojice):** `runAsPromoter` (admin-auth) + `runAsPlatformAdmin`
(platform-auth) + nově `runAsUser` (auth.ts → app.current_user_id). JWT middleware už nastavuje
`x-user-id`; wrappery to překládají na RLS kontext. Route handler stačí obalit `runAs*`.

**✅ HOTOVO (Vlna A — first-pass policy):** `migrations/331_rls_wave_a_policies.sql` generuje
policy podle vzoru tenant sloupce (user_id / promoter_id / event_id / order_id), deny-by-default.
Pokrytí stouplo na **288 tabulek s RLS / 294 policy**. platform.promoters sjednocen z `tenant_id`
na `current_promoter_id`. Ověřeno přes `tixly_rls_test`: loyalty_accounts (user_only) — vlastník
vidí jen svůj 1/5, anon 0, service 5; payment_events (order_scoped) — anon 0, service 5.

**⚠️ Na review před flipem (Vlna A nepokryla):**
- **18 dvojznačných tabulek** (mají user_id i promoter_id / user+event — nutné produktové
  rozhodnutí kdo izoluje): analytics.funnel_events, attribution.touch_points,
  marketing.event_reviews / event_rsvps / verified_fan_requests, notifications.push_notifications,
  orders.abandoned_carts / buyer_event_purchases, platform.queue_tokens, resale.resale_watchlist,
  risk.device_fingerprints, seat_upgrades.upgrade_requests, social_graph.activities,
  sport.package_game_selections, support_chat.chat_sessions, tickets.stream_token_log,
  venue_features.friend_locations, waiting_room.queue_entries.
- **~159 tabulek bez tenant sloupce** — buď referenční (public-read, nech RLS off), nebo vázané
  přes jiný FK (vyřešit per-tabulka). NEzapínat RLS bez policy = deny-all lockout.
- Generovaný vzor předpokládá user_id/promoter_id = VLASTNÍK; pokud je to created_by, policy je
  moc přísná → projeví se ve staging jako „0 řádků" a doladí se.

### 2. 431 raw-pool route handlerů bez kontextu
Tolik souborů dělá `new Pool(...)` / `pool.query` a NEnastavuje kontext (jen ~3 používají
context-aware `db()`). Pod enforce vrátí buyer/promoter dotazy 0 řádků = tiché rozbití.
Nutný codemod: `new Pool(...)` → `import { db } from '@/lib/db/rls-pool'` + obalení handleru
`runWithUserContext` / `runWithPromoterContext` podle typu auth (buyer vs promoter vs admin).

### 3. 79 tabulek bez RLS policy
Nemají žádnou policy (viz security-rls-report.md). Pod enforce jsou bez RLS = plně přístupné
(ne leak, ale chybí izolace). Doplnit policy, priorita `identity.*`, `payments.*`, `auth.*`.
Mezery i v golden-path: `catalog.event_seats`, `orders.order_items`, `identity.users` (RLS off).

## Doporučený rollout (po vlnách, ne big-bang)

1. **Sjednotit kontrakt** — rozhodnout kanonické proměnné, přepsat odchylné policy, dotáhnout
   rls-pool.ts (hotovo: user_id+role). Migrace pro standardizaci.
2. **Per-request kontext** — Next.js middleware / wrapper, který z auth session naplní
   AsyncLocalStorage (promoterId pro /admin, userId pro buyer, admin flag pro /platform).
3. **Codemod 431 souborů** na `db()` — po doménách (nejdřív orders/tickets/checkout, pak admin).
4. **Doplnit policy** pro 79+ tabulek + golden-path mezery (event_seats, order_items, users).
5. **Staging validace** přes `tixly_rls_test` (NOBYPASSRLS) — projet celou app + E2E, dokud
   nejsou žádné „0 řádků" regrese.
6. **Produkční přepnutí**: `ALTER ROLE tixly_app NOBYPASSRLS`. Rollback = zpět `BYPASSRLS`.

## Test harness (na této větvi)
Role `tixly_rls_test` (LOGIN, NOBYPASSRLS, member of tixly_app). Spuštění dotazu pod enforce
(z vnitřku kontejneru je port **5432**, ne hostový 5433):
`docker exec tixly-postgres psql "postgresql://tixly_rls_test:rls_test@localhost:5432/tixly" -c "SET app.role='system'; SELECT …"`

Pozn.: tixly_app v produkci zůstává BYPASSRLS, dokud nejsou kroky 1–5 hotové. Tato větev je
vývojová — NEslučovat do master, dokud neprojde staging validace celé app pod enforce.

---

## ✅ STAV 2026-06-08 — "admin tail" empiricky ověřen (krok 3+4 z velké části hotové)

Codemod (krok 3) je v podstatě HOTOVÝ: 375 routes používá `runAs*`/`db()` wrappery,
jen **1 soubor** zůstal na raw poolu (`api/og/events/[id]/route.tsx`, OG image). Plánem
zmiňovaných „431 raw-pool routes" už neplatí.

### Empirický audit admin plochy — `scripts/audit-admin-rls.mjs` (NOVÝ, opakovatelný)
Projel **147 tabulek** čtených `/api/admin` + `/api/platform` + `/api/organizer` pod
`tixly_rls_test` (NOBYPASSRLS), 3 kontexty (service / platform-admin / promoter):

- **🟢 0 LOCKOUTŮ** — žádná tabulka, kde RLS=on a admin i promotér vidí 0 řádků.
  → **Flip `NOBYPASSRLS` admin UI NEROZBIJE.** To byl hlavní strach z reportu.
- Našlo 7 tabulek s RLS ÚPLNĚ VYPNUTÝM (bez izolace = leak, ne lockout).

### Migrace 351 — zapnula RLS na 4 ze 7 (ověřená izolace pod test rolí)
| Tabulka | Typ | Po migraci (service / owner / cizí / anon) |
|---|---|---|
| `marketing.promo_codes` | cross-tenant leak | 16 / 3 / **0** / 0 ✓ |
| `event_groups.shares` | cross-tenant leak | 4 / 1 / **0** / — ✓ |
| `catalog.venue_seating_charts` | sdílená reference | anon **8** (read-all, write admin) ✓ |
| `catalog.moderation_blocklist` | globální config | anon **10** (read-all, write admin) ✓ |

Plus oprava skryté regrese: **`/api/promo-codes/validate` obalena `runWithServiceContext`**
(promo lookup = trusted, jako access_codes). Bez toho by pod enforce každý kód hlásil
CODE_NOT_FOUND. **Živý HTTP test pod enforced RLS:** DIVADLO20 → valid, 20 %, 500→400 Kč ✓;
bogus → CODE_NOT_FOUND ✓. Re-audit po migraci: 0 lockoutů drží, RLS-off 7→3.

### ⏭️ Tier C — 3 tabulky vědomě odložené (zapnout zvlášť, NE před flipem naslepo)
- `audit.audit_log` — zapisuje se ze VŠECH kontextů vč. DB triggeru na UPDATE
  orders/tickets. Špatná INSERT policy rozbije refundy/transfery platform-wide. Append-only,
  nízká citlivost. Potřebuje INSERT-allow-all + SELECT-restrict, otestovat zvlášť.
- `catalog.ticket_type_access` — čteno i public buyer page + scanner BEZ kontextu;
  nejdřív public-read policy + scanner service wrap.
- `tickets.wristband_transactions` — 3 ze 4 RFID routes nemají context wrapper
  (bind/charge/topup) → nejdřív codemod těch 3, pak RLS.

### GO / NO-GO checklist pro `ALTER ROLE tixly_app NOBYPASSRLS`
- [x] Veřejná read vrstva čistá (audit-public-rls.mjs: 0 reálných děr)
- [x] Buyer golden-path 4/4 pod enforce (předchozí session)
- [x] Admin tail: 0 lockoutů přes 147 tabulek (audit-admin-rls.mjs)
- [x] 2 reálné cross-tenant leaky zavřené (promo_codes, shares)
- [x] promo redemption ověřena živě pod enforce
- [ ] **Tier C** 3 tabulky dořešit (NE blocker flipu — jsou RLS-off=přístupné, jen bez izolace)
- [ ] Plný E2E sweep (e2e-full-suite) pod enforce na STAGING (ne jen lokál)
- [ ] Flip na STAGING DB, smoke, teprve pak produkce
- [ ] Rollback ready: `ALTER ROLE tixly_app BYPASSRLS;` (jednořádkový návrat)

**Závěr:** flip je technicky bezpečný už teď (0 lockoutů), leaky uzavřené. Před produkcí
chybí jen: dořešit 3 Tier C tabulky (izolace, ne funkčnost) + plný E2E na staging prostředí.
