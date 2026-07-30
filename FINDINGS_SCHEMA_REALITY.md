# FINDINGS_SCHEMA_REALITY.md

Sémantický sken kódu proti reálnému schématu. **Žádné opravy** — tenhle dokument je
vstup pro příští session.

- **Nástroj:** `nextjs-boilerplate/scripts/schema-reality-scan.mjs`
- **Běh:** 2026-07-30, ephemeral Neon větev klonovaná z produkční + aplikované
  nenasazené migrace 450/451/452, větev po běhu smazána
- **Kód:** HEAD `856c9ce`
- **Pokrytí:** 920 souborů, **2365 statických dotazů zkontrolováno**, **135 dynamických MIMO DOHLED**
- **Schéma:** 607 tabulek, 920 unique indexů, 2392 constraintů, 28 tabulek s triggerem

```
T0=2  T1=46  T2=26  T3=5  T4=59  T5=10  | celkem=148
```

---

## ⚠️ ČTI TOHLE PRVNÍ: co sken NEVIDÍ

Guard `schema-drift-guard.mjs` kdysi ohlásil pokrytí 94,7 % a vypadal jako záruka.
Nebyl — byl parse-only a celá třída exekučních chyb byla mimo jeho dohled. **Tenhle
sken má vlastní, jiné mezery a stejné pravidlo platí: „sken našel 0" ≠ „je to čisté".**

| mezera | rozsah | proč |
|---|---|---|
| **Dynamicky skládané SQL** | **135 dotazů** | Extraktor vidí jen `head` před prvním `${…}`. Column-listy, `ON CONFLICT` a `WHERE` za interpolací nezná. Sem historicky padl `checkout` x→x_coord. |
| **SQL mimo `.query(literál)`** | neznámý | Hledá se výhradně `<x>.query(<literál>)`. SQL v proměnné, vrácené z helperu, nebo poslané jinou metodou je mimo dohled. |
| **T4 nekvalifikované identifikátory** | neznámý, **velký** | T4 kontroluje **jen** `alias.sloupec`. Holé `WHERE is_published = true` se nekontroluje. **Tohle není teoretické — právě tak sken minul hlavní nález §3** (viz níže). |
| **T5 mimo IN-list** | většina CHECKů | T5 pozná jen `col = ANY(ARRAY[...])` / `col IN (...)` **a jen když je hodnota literál**. Parametrizované (`$1`) hodnoty, rozsahové a vícesloupcové CHECKy se nevyhodnocují. T5 je slabý filtr, ne záruka. |
| **Runtime-only jevy** | mimo rozsah | Race conditions, `T-AUDIT-GUC` (RESET GUC nechá `''` → 23514 nahodile), chování závislé na datech. |
| **RLS** | mimo rozsah | Introspekce jede jako `neondb_owner` (bypassrls). Co projde tady, může pod `tixly_app` vrátit 0 řádků nebo spadnout na policy. |
| **SQL soubory mimo `migrations/`** | 0 nalezeno | `git ls-files "*.sql"` mimo migrations → žádné. |
| **ORM / query buildery** | 0 nalezeno | Grep na knex/drizzle/prisma/kysely/sequelize/typeorm → nic. Projekt jede na raw `pg`. Nízké riziko. |

### Jeden systematický false positive, který jsem musel opravit
První běh dal **T3 = 78**. Všechny byly falešné: `unnest(ix.indkey)` na typu
`int2vector` **nefunguje** a vracelo prázdný seznam sloupců pro všech 920 indexů,
takže každý `ON CONFLICT` vypadal jako bez arbitru. Po opravě na
`attnum = ANY(indkey)` a množinovém porovnání: **T3 = 5**. Zaznamenáno jako
připomínka, že nezkontrolovaný nástroj lže stejně jako nezkontrolovaný dokument.

---

## TRIAGE — 89 tvrdých nálezů (T0/T1/T2/T3/T5) ve 27 lokacích

Sloupec „základ" říká, **jak jistý ten verdikt je**: `MĚŘENO` = spuštěno proti klonu,
`KÓD` = přečtena podmínka větve, `NEVÍM` = podmínku jsem nečetl, bucket je odhad
z toho, že dotaz je v hlavním toku handleru.

### 🔴 ROZBITÉ DNES — cesta selže při každém volání

| lokace | tabulka / sloupec | třída | SQLSTATE | dosažitelnost | základ |
|---|---|---|---|---|---|
| `auth/reset-password:123` | `audit.audit_log.actor_type='self'` (povoleno jen user/system/admin/platform_admin/gate/promoter) | T5 | 23514 | PUBLIC, 2 callery | **KÓD** — INSERT **není** v `.catch`, je **před `COMMIT`** → catch dělá `ROLLBACK` → **reset hesla se neprovede a vrátí 500** |
| `admin/events/[id]/program:152` | `catalog.event_programs` — 11× neexistující sloupec (`about_text`, `is_published`, `program_price_halire`, …) + chybí NOT NULL `starts_at` + `ON CONFLICT (event_id)` bez arbitru | T1×11, T2, T3 | 42703 | ADMIN, 0 UI callerů | **MĚŘENO** (schéma) |
| `programs/[eventId]:44` ⚠️ | `catalog.event_programs.is_published` — **sken to NEZACHYTIL**, viz §3 | (T4 mezera) | 42703 | PUBLIC, **linkované** z `/[locale]/program/[eventId]` ← `backstage/[eventId]:184` | **MĚŘENO** |
| `internal/cron/demand-forecast:148` | `analytics.demand_forecasts` — 9× neexistující sloupec + 2× chybějící NOT NULL | T1×9, T2×2 | 42703 | CRON | NEVÍM |
| `internal/cron/seat-upgrade-notify:84` | `orders.seat_upgrades` — `order_id`/`notified_at` neexistují, 3× chybí NOT NULL, `ON CONFLICT (order_id)` bez arbitru, `status='notified'` mimo CHECK | T1×2, T2×3, T3, T5 | 42703 | CRON | NEVÍM |
| `internal/cron/release-rolling-reserves:63` | `audit.audit_log.action='BULK_RELEASE'` (jen INSERT/UPDATE/DELETE) + `actor_type='cron'` | T5×2 | 23514 | CRON | NEVÍM |
| `foyer-orders:83` + `:95` | `foyer_orders.user_id`/`buyer_email` neexistují, chybí NOT NULL `order_id`/`items`; `orders.foyer_order_items` **tabulka neexistuje** | T1×2, T2×2, T0 | 42703/42P01 | PUBLIC | známý tiket (foyer) |
| `v1/publish/events:119/135/144` | `venues` chybí NOT NULL `city`/`country` + `ON CONFLICT (promoter_id,name)` bez arbitru; `productions.description`/`poster_url`/`status` neexistují; `events` chybí NOT NULL `organizer_id`/`title` | T1×3, T2×4, T3 | 42703 | EXTERNÍ API | **KÓD** — column-list ověřen, `organizer_id`+`title` opravdu chybí |
| `v1/wl/orders:206/217` | `order_items.unit_price_halire`/`total_price_halire` neexistují + chybí NOT NULL `unit_price`/`total_price`; `payment_events.data` neexistuje + chybí `raw_payload` | T1×3, T2×3 | 42703 | EXTERNÍ API | NEVÍM |
| `admin/reviews/send-requests:58` | `event_reviews.reviewer_email`/`reviewer_name` neexistují, chybí NOT NULL `user_id`/`rating`, `ON CONFLICT (event_id,order_id)` bez arbitru | T1×2, T2×2, T3 | 42703 | ADMIN | NEVÍM |
| `admin/broadcasts:76` | `communications.broadcasts.sent_by_user_id` | T1 | 42703 | ADMIN, 5 callerů | NEVÍM |
| `admin/events/[id]/lastminute:75` | `catalog.lastminute_rules.promoter_id` | T1 | 42703 | ADMIN, 0 callerů | NEVÍM |
| `admin/events/[id]/lottery:119` | chybí NOT NULL `lottery_campaigns.promoter_id` | T2 | 23502 | ADMIN, 0 callerů | NEVÍM |
| `admin/artists:62` | chybí NOT NULL `lineups.artists.event_id` | T2 | 23502 | ADMIN | NEVÍM |
| `admin/events/[id]/box-office/sell:90` | chybí NOT NULL `expires_at` + `payment_provider='box_office'` mimo CHECK | T2, T5 | 23502→23514 | ADMIN | **MĚŘENO** (tiket `T-BOXOFFICE-EXPIRES`) |
| `my/tickets/[ticketId]/transfer:102` | chybí NOT NULL `ticket_transfers.order_id` | T2 | 23502 | PUBLIC | NEVÍM |
| `press/accreditation:83` | chybí NOT NULL `press_accreditations.promoter_id` | T2 | 23502 | PUBLIC | NEVÍM |
| `resale/purchase/[listingId]:66` | chybí NOT NULL `orders.expires_at` | T2 | 23502 | PUBLIC | NEVÍM |
| `season-passes:162` | `orders.season_passes.holder_user_id` | T1 | 42703 | PUBLIC | NEVÍM |
| `partner/sales:103` | `payment_provider='partner_pos'` mimo CHECK | T5 | 23514 | PUBLIC | NEVÍM |
| `platform/reports/[id]:85` | `event_moderation_log.actor_type='platform_admin'` (povoleno jen auto_keyword/auto_ai/human) | T5 | 23514 | PUBLIC | NEVÍM |
| `lib/forgemsg/provision.ts:62` | `public.forgemsg_credentials` **tabulka neexistuje** | T0 | 42P01 | lib, ne route | známý tiket |

### 🟠 ROZBITÉ ZA PODMÍNKY — selže jen v některé větvi

| lokace | co | podmínka | základ |
|---|---|---|---|
| `subscriptions/checkout:125` | `ON CONFLICT (email)` bez partial predikátu → **42P10**; za ním chybějící NOT NULL `gdpr_consent_at` → 23502 | jen `if (!userId)`, tj. **guest signup**; přihlášený kupující cestu obejde | **MĚŘENO**, viz §4b |
| `admin/events/[id]/waitlist/[entryId]:87` | `payment_provider='walkin'` mimo CHECK | jen PATCH `status='converted'` | **MĚŘENO** (`T-WAITLIST-PROVIDER`) |
| `checkout:2002` | `bundle_items.price_halire`/`status` neexistují | jen `if (parkingBookingData)` — parking bundle | **KÓD** |
| `checkout/party-split/[token]:207` | chybí NOT NULL `orders.user_id` | party-split větev | NEVÍM |
| `admin/onboarding/step/[step]:128/166` | `productions.author`/`director`/`genre`/`description`/`poster_url`/`updated_at` + `events.duration_minutes`/`intermission_minutes` neexistují; `qr_policy='static'` a `vat_category='entertainment'` mimo CHECK | jen konkrétní kroky onboardingu | NEVÍM |

### ⚪ KOSMETIKA — spolknuté, nedosažitelné nebo duplicita

| lokace | co | proč kosmetika |
|---|---|---|
| `internal/cron/verify-event-completion:131` | `anomaly_alerts.payload` neexistuje + chybí NOT NULL `message` | **KÓD** — celé je v `try{}catch` a jen pro `suspicious`/`no_show` → alert se tiše nezapíše, cron doběhne |

### T4 (59 nálezů) — čtení, samostatný kbelík
T4 je nejšumnější třída a **nedávám ji do bucketů**, protože bucket by byl odhad.
Nálezy jsou v JSON výstupu s konfidencí (`high` ≤2 aliasy, `medium` ≤4, `low` víc).
Doporučení pro příští session: brát jen `high` a každý potvrdit ručně.

---

## §3 ODPOVĚĎ NA `is_published` — **FANTOM-ČTENÁŘ**

### a) Existuje sloupec? **NE. Nikde.**

`catalog.event_programs` má přesně 11 sloupců (raw `information_schema`):

```
pos  column_name    data_type                    is_nullable  column_default
1    id             uuid                         NO           gen_random_uuid()
2    event_id       uuid                         NO           null
3    event_day_id   uuid                         YES          null
4    zone_id        uuid                         YES          null
5    starts_at      timestamp with time zone     NO           null
6    ends_at        timestamp with time zone     YES          null
7    title          text                         NO           null
8    artist_name    text                         YES          null
9    description    text                         YES          null
10   display_order  integer                      NO           0
11   created_at     timestamp with time zone     NO           now()
```

`is_published` tam **není**. Celodatabázové hledání `column_name ILIKE '%publish%'`
dalo 7 sloupců a **ani jeden není na `catalog.event_programs`**:

```
catalog.event_fb_publishes.published_at / .unpublished_at
event_groups.shares.can_publish
ignite.ticket_content.is_published        ← jediný is_published v celé DB, jiná tabulka
marketing.editorial_articles.published_at
social.event_shares.published_at
tickets.wallet_content_modules.publish_at
```

Tabulky s „program" v názvu: `catalog.event_programs` (rozvrhová),
`catalog.program_cast_entries`, `orders.program_purchases`. **Centrální booklet
tabulka neexistuje** → sloupec nikdy nevznikl, není to přejmenování.

### b) Co route dělá, když dotaz padne? **NESPOLKNE TO. Hodí.**

`src/app/api/programs/[eventId]/route.ts:41-45` — celý dotaz, žádný `try`:

```ts
const pr = await db().query<ProgramRow>(
  `SELECT * FROM catalog.event_programs
   WHERE event_id = $1 AND is_published = true`,
  [eventId],
);
```

V souboru **není žádný `try`/`catch`** a **v projektu není žádný globální error
wrapper pro API routy** (grep na `withErrorHandler`/`wrapHandler` → 0; žádný
`src/app/error.tsx` ani `global-error.tsx`). Výjimka tedy probublá z handleru
a Next ji vrátí jako **HTTP 500**. Tvrzení `REMEDIATION.md:668`, že „z UI je feature
mrtvá (programInfo=null → checkbox se nevykreslí)", popisuje chování **volajícího**,
ne routy — route sama 500-uje.

Volající to navíc neošetřuje: `src/app/[locale]/program/[eventId]/page.tsx:77-90`
kontroluje jen `r.status === 404`, pak dělá `await r.json()` — na 500 tedy skončí
neodchycenou rejection v `useEffect(() => { void loadProgram(); })` → stránka
zůstane viset, bez chybové zprávy.

### c) Je route linkovaná? **ANO, ze dvou míst; jedno je živé.**

```
src/app/[locale]/checkout/page.tsx:447           fetch(`/api/programs/${eventId}`)
src/app/[locale]/program/[eventId]/page.tsx:77   new URL(`/api/programs/${eventId}`, …)
```

- checkout caller je **mrtvý** — `:445` má `if (!PROGRAM_PURCHASE_ENABLED) return;`
  a `:31` má `const PROGRAM_PURCHASE_ENABLED = false`
- viewer `/[locale]/program/[eventId]` **guard nemá** a je linkovaný z
  `src/app/[locale]/backstage/[eventId]/page.tsx:184` (`href={/${locale}/program/${eventId}}`)

### Klasifikace: **FANTOM-ČTENÁŘ**

Sloupec na té tabulce **nikdy neexistoval v žádné migraci** (celodatabázové
hledání to potvrzuje), takže není co „unpublishovat" ani kam připojit writer.
Není to HALF-WIRED (writer neexistuje a existovat nemůže), ani MRTVÝ (cesta
**je** dosažitelná a linkovaná z backstage), ani ŽIVÝ (500 při každém volání).

Zapadá to do stejného vzoru jako `is_published` na `ticket_types`, který
`REMEDIATION.md:151` už označil jako „fantom-jméno" — s tím rozdílem, že tam byla
sesterská funkční cesta (`visibility='public'`), ze které se dal záměr odvodit.
**Tady žádná sesterská cesta není** — booklet subsystém neexistuje celý.

> **Poznámka k pokrytí:** sken tenhle nález **nenašel**. `is_published` je v `WHERE`
> nekvalifikované (bez `alias.`), a T4 kontroluje jen kvalifikované odkazy. Našel
> zato jeho **writer** (`admin/events/[id]/program:152`, T1). Je to konkrétní důkaz,
> že sekce FALSE NEGATIVES není dekorace.

---

## §4a WAITLIST — chybějící transakční hranice je SYSTÉMOVÁ TŘÍDA

**Propaguje se výjimka, nebo ji někdo chytá?** Propaguje se. V projektu **není
globální error handler pro API routy** (grep výše) a
`admin/events/[id]/waitlist/[entryId]/route.ts` nemá vlastní `try`/`catch` kolem
zápisů. V live testu se to potvrdilo měřením: `await PATCH(...)` **hodí** místo
vrácení `Response` (stack `RlsAwarePool.query rls-pool.ts:156`). V Next.js se to
navenek projeví jako 500.

**Kolik dalších rout dělá multi-write bez transakční hranice: 43** (z 702 route
souborů). Kritérium: ≥2 dotazy typu INSERT/UPDATE/DELETE a **žádné** `BEGIN`,
`COMMIT`, `ROLLBACK`, `withTransaction`, `runInTransaction` ani `.connect()`.

```
 6 zápisů | admin/onboarding/step/[step]
 5 zápisů | internal/cron/push-reminders
 4 zápisů | buyer/phone-verification
 4 zápisů | internal/cron/anomaly-detect
 4 zápisů | v1/publish/events
 3 zápisů | admin/import
 3 zápisů | buyer/tickets/[ticketId]/bind-device
 3 zápisů | rfid/scan
 2 zápisů | ×35 dalších (vč. admin/events/[id]/waitlist/[entryId], foyer-orders,
            checkout/bundle, checkout/party-split, auth/forgot-password,
            auth/magic-link/request, buyer/passkeys/register, …)
```

**Verdikt: ANO, je to systémová třída, ne jednotlivost.** Waitlist není výjimka,
je to jeden ze 43. Každá z těch rout může při chybě uprostřed nechat částečný
zápis — u waitlistu **měřeno**: guest uživatel se vytvoří a commitne, objednávka
už ne.

⚠️ **Nekvalifikuji všech 43 jako bug.** U části je multi-write nezávislý nebo
idempotentní a částečný zápis nemusí být nekonzistence. Rozhodnutí, které z nich
transakci potřebují, je práce příští session — tady je jen doložený rozsah.

---

## §4b `subscriptions/checkout:125` — dokumentace se MÝLÍ v pořadí

`REMEDIATION.md:29` uvádí oba blockery, ale implikuje, že první je 23502.
**Není.** Měřeno na klonu, tři varianty téhož INSERTu:

```
1) PŘESNĚ jak je v kódu
   → 42P10  there is no unique or exclusion constraint matching the ON CONFLICT specification

2) conflict target OPRAVEN (+ WHERE anonymized_at IS NULL), gdpr POŘÁD chybí
   → 23502  null value in column "gdpr_consent_at" of relation "users"
            violates not-null constraint [column=gdpr_consent_at]

3) target opraven I gdpr dodán
   → PROŠEL, id=5c280dab-af74-407a-b5e4-931b12a6f519
```

**První chyba je 42P10, ne 23502** — arbiter indexu se řeší při plánování, tedy
**před** exekucí a před kontrolou NOT NULL. 23502 je až druhá vrstva a je
42P10 **maskovaná**. Řetěz je přesně 2 úrovně hluboký; třetí varianta prošla,
takže za tím už nic dalšího nečíhá.

Doloženo i to, proč sken dal `gdpr_consent_at` konfidenci `low`: na
`identity.users` **je** BEFORE INSERT trigger, takže heuristika správně nemohla
tvrdit jistotu (i když tady sloupec nedoplňuje):

```
trg_identity_users_updated_at  set_updated_at             BEFORE  UPDATE
trg_move_password              move_password_to_secrets   AFTER   INSERT+UPDATE
trg_sync_user_name             sync_user_name             BEFORE  INSERT+UPDATE
```

`identity.users.gdpr_consent_at`: `is_nullable=NO`, `column_default=null`.

---

## Kde začít příště (podle severity, ne podle počtu)

1. **`auth/reset-password:123`** — reset hesla dnes **nefunguje** (23514 → ROLLBACK
   → 500). Public cesta, žádný feature flag. Nejvyšší severita z celého skenu
   a v REMEDIATION.md dosud nebyla.
2. **`programs/[eventId]:44`** — fantom-čtenář na dosažitelné, linkované cestě.
   Rozhodnutí je produktové: dead-feature guard (vzor `checkout:2233`) vs. postavit
   booklet subsystém.
3. **`subscriptions/checkout:125`** — jediná rozbitá guest cesta; 2-úrovňový řetěz
   je změřený, oprava je známá, blokuje ji jen rozhodnutí o `phone?` v signatuře
   sdíleného helperu.
4. **CHECK-constraint třída (T5, 10 nálezů)** — `audit.audit_log` je v tom 2×
   (`actor_type`, `action`). Stejná třída jako `payouts.status` a
   `anomaly_alerts.alert_type` z REMEDIATION.md §7. Zaslouží jedno rozhodnutí
   napříč, ne 10 oprav.
5. **Transakční hranice (43 rout)** — nejdřív rozhodnout kritérium, které
   multi-write potřebuje atomicitu; pak dávkově.
6. **135 dynamických dotazů** — pořád nezkontrolovaných, žádným nástrojem.
