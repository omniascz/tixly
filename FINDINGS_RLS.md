# FINDINGS_RLS.md — Živé ověření §4C z TESTING_MAP.md

> **Co to je:** potvrzení/vyvrácení statických zjištění z `TESTING_MAP.md` §4C
> **živým read-only dotazem** proti produkční DB. **Nic se neopravovalo ani neseedovalo** —
> jen `SELECT` proti `pg_proc`, `pg_class`, `pg_policies`.
>
> **Cíl DB:** Neon `tixly-production`, projekt `fragrant-wildflower-75132205`,
> větev `br-rough-paper-alom0zky` (production/default), role `neondb_owner`.
> Přístup přes Neon HTTP SQL API (obchází Vercel encrypted `DATABASE_URL`).
> **Datum běhu:** 2026-07-04.
>
> **Legenda verdiktů:** ✅ POTVRZENO · ❌ VYVRÁCENO · ⚠️ ČÁSTEČNĚ (jádro sedí, detail jinak).

---

## 🔴 Hlavní závěr: živá DB je PŘED `db/baseline.sql`

`TESTING_MAP.md` byl postaven staticky z `db/baseline.sql` (snapshot **2026-06-01**) +
migrací `375–449` v repu. **Produkce má aplikované další opravy, které v tomto snapshotu
ani v migračním adresáři nejsou.** Právě z toho pramení **všechny tři chybné predikce mapy**
(app_is_service, event_seats, order_items). Naopak zjištění o **name-driftu jsou v produkci
reálná a stále přítomná** — ty opravené nebyly.

Poučení do metody: statická analýza repa **podhodnotila** stav prod schématu.
Živý `pg_policies` dump je pro RLS závěry nutný, ne volitelný.

---

## Dotaz 1 — Existuje `app_is_service()`?

```sql
SELECT proname FROM pg_proc WHERE proname = 'app_is_service';   -- + rozšíření na app_*
```

| Predikce (mapa §0/§4C) | Skutečnost (live) | Verdikt |
|---|---|---|
| `app_is_service()` **NEEXISTUJE** (baseline ji nemá; policies 375+ ji volají naprázdno) | **EXISTUJE** v `public`, `ROWCOUNT=1`. Tělo: `SELECT ... current_setting('app.role',true) IN ('service','admin','system')` | ❌ **VYVRÁCENO** |
| (mapa uváděla jen 2 helpery z baseline: `app_current_promoter_id`, `app_is_platform_admin`) | Živě existují **4**: `app_current_promoter_id`, **`app_current_user_id`**, `app_is_platform_admin`, **`app_is_service`** | ❌ mapa neúplná |

**Dopad:** policies, které volají `app_is_service()` / `app_current_user_id()` (mj. nové
policies na `event_seats`, `order_items`, modular-pass), **nejsou mrtvé** — funkce reálně
čtou kanonický `app.role` resp. `app.current_user_id`. Ruší to část „name-drift" argumentu
mapy pro tyhle konkrétní tabulky (ne však pro ty s doslovným `current_setting('app.is_service')`
— viz Dotaz 3).

---

## Dotaz 2 — Mají `event_seats`, `order_items`, `purchase_agents`, `agent_mandates` RLS OFF?

```sql
SELECT n.nspname, c.relname, c.relrowsecurity, c.relforcerowsecurity FROM pg_class c ...
```

| Tabulka | Predikce mapy (§4C) | `relrowsecurity` (live) | Má funkční policy? (live) | Verdikt |
|---|---|---|---|---|
| `catalog.event_seats` | RLS **OFF**, jen app-layer | **`true`** | ✅ `p_event_seats_event_scope` (ALL): `app_is_platform_admin() OR app_is_service() OR event.promoter=app_current_promoter_id() OR event.status='published'` — **kanonické helpery** | ❌ **VYVRÁCENO** |
| `orders.order_items` | RLS **OFF**, jen app-layer | **`true`** | ✅ `p_order_items_scope` (ALL): admin OR service OR `o.user_id=app_current_user_id()` OR promotér přes event — **kanonické helpery** | ❌ **VYVRÁCENO** |
| `platform.purchase_agents` | RLS **OFF** | **`false`** | žádná policy | ✅ **POTVRZENO** |
| `platform.agent_mandates` | RLS **OFF** | **`false`** | žádná policy | ✅ **POTVRZENO** |

`relforcerowsecurity=false` u všech (tj. vlastník tabulky RLS obchází; `tixly_app` ale ne).
**event_seats i order_items jsou v produkci chráněné na DB úrovni** správně klíčovanými
policies — mapa se mýlila (baseline je neměl). Agent-lane tabulky bez RLS **potvrzeny**.

---

## Dotaz 3 — Doslovný text policies: nekanonické varnamy

```sql
SELECT schemaname, tablename, policyname, qual, with_check FROM pg_policies
WHERE schemaname IN ('catalog','orders','lineups','platform','marketing','resale') ...
```

**Souhrn:** drift-detektor napříč **všemi** schématy našel **38 policies** používajících
nekanonický varname. Aplikace (`src/lib/db/rls-pool.ts`) nastavuje **pouze**
`app.current_promoter_id`, `app.current_user_id`, `app.is_platform_admin`, `app.role`.
Následující varnamy **žádný kód nikdy nenastaví** → predikát je pro `tixly_app` trvale
nepravdivý (mrtvá větev):

| Nekanonický var (live) | Správně | Výskyt v policies |
|---|---|---|
| `app.promoter_id` | `app.current_promoter_id` / `app_current_promoter_id()` | event_distribution_partners, event_sponsors, event_travel_links, performance_cast, venue_gates, wero_payments/webhooks |
| `app.user_id` | `app.current_user_id` / `app_current_user_id()` | event_travel_packages, magic_link_tokens, ticket_alerts, box_office_sales/sessions, postal_deliveries, seat_upgrades, ticket_transfers, travel_bookings |
| `app.is_service` (doslovný) | `app_is_service()` / `app.role` | oauth_accounts, artist_follows, venue_gates |
| `app.bypass_rls = 'on'` | `app_is_service()` | accommodation_offers, parking_offers, rfid_*, bundle_items, resale_listings, qes_signing_requests, royalty_*, artist_payouts |
| `app.use_service_role` | `app_is_service()` | event_sponsors, event_travel_links |
| `app.is_admin` | `app.is_platform_admin` | **wero_payments, wero_webhooks** (mimo výčet mapy — bonus) |

### §4C: predikce mapy × skutečnost × verdikt (per tabulka)

| Tabulka | Predikce mapy | Live realita (všechny policies) | Verdikt |
|---|---|---|---|
| `catalog.event_distribution_partners` | **plně zamčená** (jediná cesta přes rozbitý var) | 4 policies, **všechny** `app.promoter_id`, žádná admin/canonical větev | ✅ POTVRZENO |
| `orders.resale_listings` | plně zamčená | 1 policy `resale_bypass` = `app.bypass_rls='on'` only | ✅ POTVRZENO |
| `lineups.royalty_agreements` / `royalty_ledger` / `artist_payouts` | plně zamčené | po 1 policy `*_svc` = `app.bypass_rls='on'` only | ✅ POTVRZENO |
| `platform.qes_signing_requests` | plně zamčená | 1 policy `qes_requests_svc` = `app.bypass_rls='on'` only | ✅ POTVRZENO |
| `catalog.rfid_zones/devices/presence/access_log` | plně zamčené | po 1 policy `*_svc` = `app.bypass_rls='on'` only | ✅ POTVRZENO |
| `orders.bundle_items` | plně zamčená | 1 policy `bundle_items_svc` = `app.bypass_rls='on'` only | ✅ POTVRZENO |
| `catalog.event_sponsors` | promotér+service mrtvé, **jen admin funguje** | `platform_admin_event_sponsors` (CANONICAL, ALL) + 2 drift policy | ✅ POTVRZENO |
| `catalog.event_travel_links` | promotér+service mrtvé, **jen admin funguje** | `platform_admin_event_travel_links` (CANONICAL) + 2 drift policy | ✅ POTVRZENO |
| `orders.ticket_transfers` | buyer větev mrtvá, admin SELECT funguje, UPDATE otevřený | `ticket_transfers_sender` SELECT = `from_user_id=app.user_id` (mrtvé) **OR `app.is_platform_admin` (funguje)**; `_insert` WITH CHECK `app.user_id` (mrtvé); `_update` = ne-tenantová (OTHER, patrně `USING(true)`) | ✅ POTVRZENO |
| `orders.travel_bookings`, `box_office_sales/sessions`, `postal_deliveries`, `seat_upgrades` | buyer/promotér větev mrtvá (`app.user_id`), admin funguje | potvrzeno — každá má `app.is_platform_admin` větev (funguje) + `app.user_id` větev (mrtvá) | ✅ POTVRZENO |
| `marketing.ticket_alerts` | **over-exposed**: větev `app.user_id=''` → čitelné vše bez kontextu | qual větev existuje, ALE měřením **NEfunguje**: nenastavený `app.user_id` → `current_setting` vrací **NULL**, ne `''`; `NULL = ''` = NULL (nepravda) → bez kontextu count=**0**. Viz behaviorální sekce níže. | ❌ **VYVRÁCENO (behaviorálně)** — oprava statického verdiktu |

### Bonus zjištění (nebylo v mapě)

- **`payments.wero_payments` + `payments.wero_webhooks` jsou plně mrtvé.** Tenant-isolation
  policy klíčuje na `app.promoter_id` **i** `app.is_admin` — **obě** nekanonické, nikdy
  nenastavené. Žádná funkční větev → tabulky pro `tixly_app` fakticky nedostupné přes RLS.
  (Schéma `payments` nebylo ve výčtu mapy §4C.)
- Helper **`app_current_user_id()` v produkci existuje** (mapa ho z baseline neznala).

---

## Net verdikt

| Kategorie zjištění mapy §4C | Verdikt |
|---|---|
| `app_is_service()` neexistuje | ❌ **VYVRÁCENO** — existuje |
| `event_seats` bez RLS | ❌ **VYVRÁCENO** — RLS on + kanonická policy |
| `order_items` bez RLS | ❌ **VYVRÁCENO** — RLS on + kanonická policy |
| `purchase_agents` / `agent_mandates` bez RLS | ✅ **POTVRZENO** |
| Name-drift je reálný a přítomný v prod (38 policies) | ✅ **POTVRZENO** |
| Konkrétní „plně zamčené" tabulky (edp, resale_listings, royalty*, qes, rfid*, bundle_items) | ✅ **POTVRZENO** (7 skupin) |
| „Jen admin funguje" (event_sponsors, event_travel_links) | ✅ **POTVRZENO** |
| „Buyer mrtvý / admin funguje" (ticket_transfers, travel_bookings, box_office*, postal_deliveries, seat_upgrades) | ✅ **POTVRZENO** |
| `ticket_alerts` over-exposure | ❌ **VYVRÁCENO behaviorálně** (statický verdikt opraven — viz sekce níže) |
| Bonus: `wero_payments/webhooks` plně mrtvé; `app_current_user_id()` existuje | ➕ nové, mimo mapu |

**Shrnutí:** jádro §4C (systematický name-drift → mrtvé/over-exposed RLS predikáty)
je živě **potvrzeno**, a to i na tabulce navíc (`wero_*`). Tři predikce mapy padly,
všechny ze stejné příčiny — **mapa četla `baseline.sql` starší než produkce**; opravy
helperů a RLS na `event_seats`/`order_items` byly do prod nasazeny až po snapshotu.

---

## Behaviorální ověření leaku na `marketing.ticket_alerts` (2026-07-04)

**Cíl:** potvrdit/vyvrátit statické tvrzení „over-exposed / world-readable" **měřením**, ne z kódu.

**Metoda (read-only, nic nepersistuje):** připojení **přímo jako `tixly_app`** (Neon API vrátí
conn string; `rolbypassrls=false` → RLS reálně platí; `neondb_owner` NELZE použít, má
`bypassrls=true`). `SET ROLE tixly_app` selhal (členství bez SET option v PG16), proto přímé
připojení. Vše v **jedné transakci ukončené `ROLLBACK`** — prod byl prázdný (0 eventů/venues),
takže se v tx vytvořil dočasný venue+event+2 alerty (user A=`…0002`, B=`…0003`) a po měření
se vše zahodilo. **Ověřeno: po ROLLBACK 0 řádků, nic v prod nezůstalo.**

### Naměřené hodnoty (pod rolí `tixly_app`, RLS aktivní)

| # | Nastavený kontext | `count(*)` | Očekávání mapy | Skutečnost |
|---|---|---|---|---|
| seed | `app.is_platform_admin='true'` (jen pro INSERT) | 2 | — | admin vidí obě |
| **(a)** | **žádný** (app.user_id=NULL, admin='false') | **0** | 2 (world-readable) | **žádný leak** |
| (b) | `app.current_user_id=A`, `app.role='user'` (kanonicky) | **0** | 1 (jen A) | uživatel nevidí ani **své** řádky |
| (c) | `app.user_id=A` (nekanonický var, co policy čte) | **1** | — | scoping zabere jen přes špatný var |
| (d) | `app.user_id=''` (explicitní prázdný string) | **2** | — | leak větev fires — ale app to NIKDY nenastaví |

### Proč statická analýza šlápla vedle

Predikce mapy stála na předpokladu, že nenastavený GUC `app.user_id` vrací `''` →
`'' = ''` → TRUE → leak. **Realita (naměřeno):** `current_setting('app.user_id', true)` u
**nenastaveného** varu vrací **NULL**. `NULL = ''` je v SQL **NULL** (ne TRUE) → leak větev
neprojde. Leak větev vystřelí **výhradně** při doslovném `SET app.user_id = ''` — scénář (d).

**Důsledek driftu je opačný než „over-exposure":** protože policy čte `app.user_id` (který
app nikdy nenastaví — viz `rls-pool.ts` nastavuje jen `app.current_user_id`), tabulka je pro
běžné role fakticky **nečitelná** (scénář a,b = 0 řádků), ne world-readable.

### Krok 4 — je díra vůbec dosažitelná z aplikace? NE

Grep celého repa: `marketing.ticket_alerts` se v kódu vyskytuje **jen** v jediném handleru
`src/app/api/events/[id]/alert/route.ts`:

| Operace | Řádek | Kontext (runWith*?) | RLS policy, co to pustí |
|---|---|---|---|
| **INSERT** (přihlášení k upozornění) | `:38` | **žádný** — `db().connect()` bez wrapperu; `x-user-id` se jen uloží do sloupce | `ticket_alerts_insert WITH CHECK (true)` |
| **UPDATE** (odhlášení dle `token`) | `:64` | **žádný** — `db().connect()` bez wrapperu | `ticket_alerts_update USING (true)`; scoping přes neuhodnutelný `token` |
| **SELECT** | — | **NEEXISTUJE** žádný v celém kódu | „leaková" `ticket_alerts_select` policy se v aplikaci **nikdy nevykoná** |

Závěr: leak **není dosažitelný** ze dvou nezávislých důvodů — (1) sémantika GUC (NULL≠''),
(2) v aplikaci neexistuje žádná čtecí cesta, která by SELECT policy vůbec vyvolala.
(Zápisové cesty běží zcela bez RLS kontextu a spoléhají na `WITH CHECK(true)` / `token`.)

**Verdikt:** statické tvrzení §4C „ticket_alerts je over-exposed / world-readable" je
**VYVRÁCENO**. Skutečný efekt name-driftu na této tabulce je pravý opak (nečitelnost přes RLS),
a i ten je bezpředmětný, protože žádný route handler tabulku nečte.

---

*Poznámka k rozsahu:* ověřeny byly definice policies a RLS-flagy (statická pravda o DB).
Nebyl spuštěn dotaz „pod konkrétní session vars" (např. `SET app.role='promoter'; SELECT
count(*) FROM …`), který by změřil skutečný počet vrácených řádků. Závěr „mrtvá větev"
plyne z faktu, že `rls-pool.ts` dané varnamy nenastavuje — což je jistota na úrovni kódu,
ne experimentální běh. **Nic se neměnilo.**
