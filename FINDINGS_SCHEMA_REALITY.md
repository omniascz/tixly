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

---
---

# AKTUALIZACE 2026-07-30 (druhá session) — doostření + první fixy

## §1 Doostření: 15× `NEVÍM` → 0× `NEVÍM`

Bylo jich **15, ne 14** (v prvním reportu jsem to spočítal špatně). Verdikt
`KÓD` = přečtena podmínka větve i obal výjimky; `MĚŘENO` = spuštěno proti klonu.

| lokace | bucket PO doostření | mechanika | základ |
|---|---|---|---|
| `admin/broadcasts:76` | ROZBITÉ DNES | hlavní tok, `db()` autocommit, v souboru **0 catch bloků** → probublá → 500 | KÓD |
| `admin/events/[id]/lastminute:75` | ROZBITÉ DNES | dtto (0 catch bloků) | KÓD |
| `admin/events/[id]/lottery:119` | ROZBITÉ DNES | dtto (0 catch bloků) | KÓD |
| `admin/artists:62` | ROZBITÉ DNES | dtto (0 catch bloků) | KÓD |
| `admin/reviews/send-requests:58` | ROZBITÉ DNES | hlavní tok ve smyčce, `runWithServiceContext(db().query)`, 0 catch bloků → 500 | KÓD |
| `press/accreditation:83` | ✅ **OPRAVENO** | hlavní tok, autocommit, 0 catch → 500 | **MĚŘENO** |
| `resale/purchase/[listingId]:66` | ✅ **OPRAVENO** | hlavní tok, autocommit | **MĚŘENO** |
| `season-passes:162` | ROZBITÉ DNES | v tx → ROLLBACK → 500 | KÓD |
| `my/tickets/[ticketId]/transfer:102` | ROZBITÉ DNES | v tx → ROLLBACK → 500; **2 vrstvy** (viz níže) | KÓD + introspekce |
| `partner/sales:103` | ROZBITÉ DNES | v tx → ROLLBACK → 500; **chce migraci** | KÓD |
| `v1/wl/orders:206` | ROZBITÉ DNES | v tx, hned za dekrementem inventáře → ROLLBACK (bez orphanu) → 500 | KÓD |
| `internal/cron/release-rolling-reserves:63` | ROZBITÉ DNES | v tx, **není** v `.catch` → ROLLBACK → uvolnění rezerv se NEPROVEDE (finanční) | KÓD |
| `internal/cron/demand-forecast:148` | ROZBITÉ DNES **ale TIŠE** | per-event `try{}catch` (`:128`/`:191`), autocommit → cron vrátí úspěch a **nezapíše nic** | KÓD |
| `internal/cron/seat-upgrade-notify:84` | 🔴 **FALSE SUCCESS** | viz §5 níže — samostatná, horší třída | KÓD |
| `platform/reports/[id]:85` | **ZA PODMÍNKY** | jen `if (status==='resolved_action' && suspendEvent && event_id)`; v tx → ROLLBACK vezme i suspendaci akce | KÓD |

## §5 NOVÝ NÁLEZ: `seat-upgrade-notify` je FALSE SUCCESS, ne obyčejná 500

Nejde o „padá to". Mechanika (`REMEDIATION.md:585`, varianta A):
1. Jediný zápis v transakci (`:84`) je obalený `.catch(() => {})` (`:87`) → chyba se **spolkne**
2. `notified++` se přesto zvýší
3. Transakce je ale **aborted** → každý další kandidát padne na **25P02**, odchytí ho
   per-kandidát `catch` na `:96`
4. `COMMIT` na `:102` na aborted tx Postgres provede **tiše jako ROLLBACK**, bez throw
5. Handler vrátí **`{ok: true, notified: N}`** s N ≥ 1

Cron tedy tvrdí, že odeslal upozornění, a nezapsal ani řádek. Vyšší severita než
čistá 500, protože to nikdo nepozná. **Neopraveno** — chce rozhodnutí, jestli
subsystém seat-upgrade dostavět (chybí 3 tabulky) nebo cestu vypnout jako foyer.

## §6 Vrstvení: potvrzeno, že 2 vrstvy nejsou výjimka

| lokace | vrstva 1 | vrstva 2 | vrstva 3 |
|---|---|---|---|
| `subscriptions/checkout:125` | 42P10 (arbiter) | 23502 `gdpr_consent_at` | žádná |
| `auth/reset-password:123` ✅ | **42P08** (`$1` = text I uuid) | 23514 `actor_type='self'` | žádná |
| `my/tickets/transfer:102` | 23502 `order_id` | **42703** `RETURNING token` (sloupec je `transfer_token`) | ? |
| `box-office/sell:90` | 23502 `expires_at` | 23514 `payment_provider='box_office'` | ? |
| `press/accreditation:83` ✅ | 23502 `promoter_id` | žádná (změřeno) | — |
| `resale/purchase:66` ✅ | 23502 `expires_at` | žádná (změřeno) | — |

**42P08 nevidí ani jeden z našich nástrojů:** `schema-drift-guard.mjs` ho má
v pravidlech jako INCONCLUSIVE, ne drift (`REMEDIATION.md:497`), a
`schema-reality-scan.mjs` odvozování typů parametrů nepokrývá žádnou z pěti tříd.
Doplněno do FALSE NEGATIVES: **sdílený parametr `$N` použitý na sloupce různých
typů = celá nepokrytá třída.**

## §7 Delta skenu po 3 fixech

```
PŘED: 148   PO: 145
UBYLO (3):  T2 press_accreditations.promoter_id
            T2 orders.expires_at (resale/purchase)
            T5 audit_log.actor_type (auth/reset-password)
PŘIBYLO (0)
```

Žádná nová vrstva se pod opravami neodkryla — což je konzistentní s tím, že
u všech tří byl peel na klonu čistý.

---
---

# AKTUALIZACE 2026-07-30 (třetí session) — tiché crony, seed factory

## §8 NOVÁ TŘÍDA: tiché selhání cronů — je jich 9, ne 3 ani 30

Prohledány všechny `src/app/api/internal/**` (43 souborů) na dva vzorce:
`.catch()` navěšený na zápisový dotaz, a `try{zápis}catch{}` bez rethrow.

| route | vzorec | co se stane s daty | hlásí úspěch? |
|---|---|---|---|
| `internal/cron/seat-upgrade-notify:83` + `:66` | `.catch(()=>{})` **+** try/catch ve smyčce **+** `COMMIT` na aborted tx | **nic se nezapíše**, `notified` se zvýší | 🔴 **ano — `{ok:true,notified:N}`** |
| `internal/resale/complete-transfer:96` | `.catch()` inert, autocommit | zápis chybí | 🟠 ano |
| `internal/cron/demand-forecast:128` | try/catch ve smyčce, čítač `processed` | per-event zápis chybí | 🟠 ano |
| `internal/cron/verify-event-completion:129` | try/catch ve smyčce | alert se nezapíše | 🟠 ano |
| `internal/cron/bank-sync-fio:57` | try/catch ve smyčce | per-transakce zápis chybí | 🟠 ano |
| `internal/cron/onboarding-reminder:137` | try/catch ve smyčce | per-promotér zápis chybí | 🟠 ano |
| `internal/order-completed:408, :462` | 2× try/catch bez rethrow | post-processing chybí | 🟠 ano |
| `internal/cron/consent-log-purge:30` | try/catch → explicitně `{ok:true,purged:0}` | purge se neprovede | 🟠 ano — **záměrně**, komentář `:41` |
| `internal/web-vitals:33` | try/catch bez rethrow | metrika se nezapíše | 🟠 ano |

**Metodická korekce:** první verze detektoru hlásila 12. Regex na „rethrow"
nepřekročil vnořené závorky → označil i **hlasité** handlery
(`release-rolling-reserves`, `expire-pending-orders`, `event-payout-release`
z catch vracejí **500**). Po opravě 8 + 1 z prvního průchodu = 9.

⚠️ **Tichost sama není bug** — stává se jím teprve, když je zápis pod ní rozbitý.
Z těch 9 má sken rozbitý zápis potvrzený u **3** (`seat-upgrade-notify`,
`demand-forecast`, `verify-event-completion`). U zbylých 6 to NEBYLO ověřeno.

---

# 🕶️ SLEPÁ MÍSTA — konsolidovaný seznam (čemu NEVĚŘIT)

Jedno místo pravdy o tom, co **žádný** z našich nástrojů nevidí.

| # | třída | rozsah | vidí guard? | vidí sken? |
|---|---|---|---|---|
| 1 | **Typová inference parametrů (42P08)** — týž `$N` pro sloupce různých typů | neznámý | ❌ má ho jako INCONCLUSIVE (`REMEDIATION.md:497`) | ❌ nepokrývá žádná z 5 tříd |
| 2 | **Dynamicky skládané SQL** | **135 dotazů** | ❌ vypisuje jmenovitě jako mezeru | ❌ dtto |
| 3 | **Nekvalifikované identifikátory v T4** | neznámý, velký | ❌ | ❌ jen `alias.sloupec` |
| 4 | **SQL mimo `.query(literál)`** | neznámý | ❌ | ❌ |
| 5 | **CHECK mimo IN/ARRAY list + parametrizované hodnoty** | většina CHECKů | ❌ | ⚠️ jen literály |
| 6 | **Spolknuté chyby (tichý no-op)** | 9 rout, viz §8 | ❌ | ❌ statický sken nevidí runtime |
| 7 | **`COMMIT` na aborted tx** (třída 1 FALSE SUCCESS) | ≥1 potvrzený | ❌ | ❌ |
| 8 | **RLS** | celé | ❌ | ❌ introspekce jede jako bypassrls owner |
| 9 | **Runtime-only** (race, T-AUDIT-GUC, data-dependent) | — | ❌ | ❌ |

**Objevené tím, že se na ně narazilo, ne tím, že je nástroj našel:** #1 (fix
`auth/reset-password`), #3 (`programs/[eventId] is_published`), #7
(`seat-upgrade-notify`). To je empirický důvod nevěřit číslu „celkem=144".

---

# §9 Seed factory (`tests/helpers/live-fixture.ts`)

`tests/helpers/` neexistovalo; Neon boilerplate byl duplikovaný ve všech 5 live
testech, entity seed ve 3, a kopie se rozcházely v tom, které NOT NULL sloupce
dodávají. Factory je jedno místo pravdy.

**Zásada:** lístky se NESEEDUJÍ ručně — volá se `issueTicketsForOrder`
(táž funkce jako checkout/comps/guestlist), protože jen ona ví, jak se plní
`totp_secret_encrypted` / `totp_secret_iv` / `ticket_seq`. Uživatelé jdou přes
`createOrGetGuestUser`. Seed, který vyrobí data jiného tvaru než produkce,
je horší než žádný.

Důkaz: `tests/live-fixture.live.test.ts` (4 aserce nad factory samotnou);
`auth-reset-password.live.test.ts` přepsán 202 → 152 řádků, pořád zelený.

# §10 Delta po fixech této session

```
148 (výchozí) → 145 (po reset-password/press/resale) → 144 (po season-passes)
UBYLO: T1 season_passes.holder_user_id
PŘIBYLO: žádné
```

---
---

# AKTUALIZACE 2026-07-30 (čtvrtá session) — doměření tichých rout + čisté opravy

## §11 Doměření 7 zápisů z tichých rout — 5 z 9 je NEŠKODNÝCH

Metoda: každý zápis pustit na klonu v zahozené transakci. Diskriminátor —
**23503 (FK violation) znamená, že sloupce i CHECKy prošly**, tedy struktura
je v pořádku; 42703/42P01/23502/23514 znamená rozbitý zápis.

| route | verdikt | důkaz |
|---|---|---|
| `resale/complete-transfer:96` | ✅ **ZÁPIS FUNGUJE** | 23503 `{seller_payouts_listing_id_fkey}` — jen FK |
| `cron/bank-sync-fio:57` | ✅ **ZÁPIS FUNGUJE** | prošel naostro |
| `cron/onboarding-reminder:137` | ✅ **ZÁPIS FUNGUJE** | prošel naostro |
| `cron/consent-log-purge:30` | ✅ **ZÁPIS FUNGUJE** | prošel naostro |
| `web-vitals:33` | ✅ **ZÁPIS FUNGUJE** | prošel naostro |
| `cron/verify-event-completion:129` | 🔴 **ZÁPIS ROZBITÝ** | 42703 `payload` neexistuje |
| `order-completed:462` | 🔴 **ZÁPIS ROZBITÝ** | 23514 `{ticket_modular_access_level_check}` — `access_level='full'` mimo výčet |

**`order-completed:462` je NOVÝ nález** — sken ho nenašel (T5 ten INSERT ve
vnořené smyčce nerozparsoval). Modular-pass přístupy se tiše nezapisují.

**Bilance třídy:** z 9 tichých rout má rozbitý zápis **4** (`seat-upgrade-notify`,
`demand-forecast`, `verify-event-completion`, `order-completed:462`), zbylých
5 zapisuje správně a jejich tichost je dnes neškodná.

### `consent-log-purge` — záměr, nebo racionalizace?
Komentář `:41` říká: *„Tabulka neexistuje → migration neaplikována; vrať 200 ať
cron nepadá"*. **Je to racionalizace.** Změřeno: `compliance.cookie_consent_log`
na produkční větvi **existuje** a DELETE projde. Předpoklad komentáře tedy
neplatí. Navíc catch polyká **jakoukoli** chybu a vrací `purged: 0`, což je
nerozlišitelné od poctivého smazání nula řádků — GDPR purge může tiše přestat
fungovat a nikdo se to nedozví. Doporučení do backlogu: chytat jen `42P01`,
zbytek propagovat.

## §12 Protřídění zbytku fronty (introspekcí, PŘED opravou)

| lokace | kategorie | důvod |
|---|---|---|
| `v1/wl/orders:206` ✅ | ČISTÁ | `unit_price`/`total_price` existují |
| `v1/wl/orders:217` ✅ | ČISTÁ | `raw_payload` existuje |
| `lastminute:75` ✅ | ČISTÁ | `promoter_id` na tabulce NENÍ → odstranit |
| `lottery:119` ✅ | ČISTÁ | `promoter_id` JE NOT NULL, jen se nedodával |
| `admin/broadcasts:76` ⚠️ | ČÁSTEČNĚ | `sent_by_user_id` odstranit = čisté; `target='event'` mimo CHECK = migrace |
| `my/tickets/transfer:102` 🔧 | **CHCE MIGRACI** | viz §13 |
| `admin/artists:62` 🔧 | **CHCE MIGRACI** | `lineups.artists.event_id` je NOT NULL, ale route je promotér-level katalog bez akce |
| `admin/reviews/send-requests:58` 🎫 | **NEPOSTAVENÝ SUBSYSTÉM** | `event_reviews` vyžaduje `user_id` + `rating` (CHECK 1–5); „žádost o recenzi" není recenze a nemá kam |

## §13 `ticket_transfers` je mrtvá na úrovni DDL — 3 vrstvy

```
VRSTVA 1  RED, jak je v kódu            → 42703 column "token" does not exist
VRSTVA 2  + order_id, pořád RETURNING token → 42703 (dtto — parse předchází exekuci)
VRSTVA 3  + RETURNING transfer_token AS token → 22023 unrecognized encoding: "base64url"
```

Třetí vrstva NENÍ v aplikaci. `migrations/416_ticket_transfers.sql:11`:
```sql
transfer_token text NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(24), 'base64url'),
```
**🔧 KOREKCE 2026-07-30:** dřívější tvrzení „`base64url` umí Postgres až od PG 18;
produkční větev běží na starší verzi" **BYLO ŠPATNĚ**. `base64url` v `encode()`
přibyl až v **PostgreSQL 19** (commit `e1d91718`), a ta zatím **nevyšla**.
Nejde tedy o starou větev Neonu — **ten výraz nefunguje nikde**, na žádné
existující verzi Postgresu. Migrace 416 je rozbitá absolutně, ne relativně.

→ do `orders.ticket_transfers` **nelze vložit žádný řádek**, ať kód udělá cokoli.
Migrace se aplikovala, tabulka existuje, ale je nepoužitelná. **Oprava chce
migraci** (zrušit DEFAULT a generovat token v Node).

Korekce dřívějšího tvrzení: v minulé session jsem psal, že vrstva 1 je
`23502 order_id`. Není — parse-time 42703 na `RETURNING token` přichází dřív.

## §14 Delta

```
144 → 135   (ubylo 9, PŘIBYLO 0)
```

---
---

# AKTUALIZACE 2026-07-30 (pátá session) — BLOK A + B

## §15 🔟 DESÁTÁ TŘÍDA: odložené vyhodnocení v DDL

**Vzorec:** migrace projde, tabulka vznikne, ale výraz v `DEFAULT` /`CHECK`/
generated column se vyhodnotí až při INSERTu. Do té doby to nikdo nepozná:
guard dělá `PREPARE` (DEFAULT se nevyhodnocuje), sken čte `column_default`
jako **text** a neptá se, jestli ten text vůbec jde spustit.

**Metoda:** vytáhnout všechny DEFAULTy obsahující volání funkce (mimo `nextval`)
a každý REÁLNĚ vyhodnotit `SELECT <expr>` na klonu.

```
DEFAULTů s voláním funkce: 1292
CHECKů s voláním funkce:      10
generated columns:             2
SELHÁVAJÍCÍCH:                 3
```

| tabulka.sloupec | výraz | chyba | zapisovatelé v `src/` |
|---|---|---|---|
| `marketing.ticket_alerts.token` | `encode(gen_random_bytes(16),'base64url')` | `22023 unrecognized encoding` | `events/[id]/alert/route.ts` |
| `orders.party_split_sessions.share_token` | `encode(gen_random_bytes(18),'base64url')` | `22023` | `checkout/party-split/route.ts`, `checkout/party-split/[token]/route.ts`, `internal/order-completed`, `cron/audience-geo-snapshot` |
| `orders.ticket_transfers.transfer_token` | `encode(gen_random_bytes(24),'base64url')` | `22023` | `my/tickets/[ticketId]/transfer`, `tickets/transfer/[token]` |

**Není to jedna rozbitá migrace, je to zkopírovaný idiom ve třech.** Všechny tři
tabulky jsou dnes **nepoužitelné** — nelze do nich vložit žádný řádek. Dotčené
featury (ticket alerts, party split, P2P transfer) jsou mrtvé na úrovni DDL,
ne aplikace.

**🔧 KOREKCE dřívějšího tvrzení:** psal jsem, že `base64url` umí Postgres od
PG 18 a produkční větev je starší. **Špatně.** `base64url` v `encode()` přidal
až **PostgreSQL 19** (commit `e1d91718`), který zatím **nevyšel** → ten výraz
nefunguje **nikde**, na žádné existující verzi. Není to konfigurace Neonu.

**Mezera, kterou tenhle sken nepokrývá:** 10 CHECKů s voláním funkce nejde
ověřit izolovaným `SELECT` (vyhodnocují se proti NEW řádku) — pozná je až INSERT.

## §16 Stav migrací 450/451/452 — NEJSOU aplikované

Ověřeno **dvakrát nezávisle** proti produkční větvi `br-rough-paper-alom0zky`:

```
450/451/452 v public.schema_migrations : ŽÁDNÁ
tickets.ticket_seq (efekt mig 450)     : NENÍ
orders_payment_provider_check kiosk_card: NENÍ
tracking_events_provider_check tiktok  : NENÍ
```

→ **Verdikt: smějí se EDITOVAT**, není třeba stavět 453+ patro.

### Dva vedlejší nálezy z toho měření

1. **`scripts/prod-migrate-runner.mjs:41` je rozbitý.** Dělá
   `SELECT version FROM public.schema_migrations`, ale tabulka má sloupce
   **`filename`, `applied_at`** — žádný `version`. → `42703` při každém spuštění.
   Migrační runner tedy dnes nefunguje.
2. **Evidence migrací je STALE.** `schema_migrations` má 245 řádků a končí na
   `339_rls_submodule_tables_policies.sql`, ale schéma je reálně mnohem dál
   (mig 340–449 se aplikovaly, aniž se zapsaly). → **zdrojem pravdy o stavu
   schématu je schéma samo, ne ta tabulka.** Konzistentní s dřívějším poučením
   „baseline.sql je stale".

---
---

# AKTUALIZACE 2026-07-30 (šestá session) — DEPLOY CESTA: diagnóza

## §17 Migrace se aplikují TŘEMI soupeřícími cestami; ta, která běží, je nejhorší

### Cesta 1 — `.github/workflows/deploy.yml:86-91` — **jediná, co reálně běží**

```yaml
for migration in migrations/*.sql; do
  echo "Aplikuji: $migration"
  psql "$DATABASE_URL" -f "$migration"
done
```

Pět nezávislých vad:

1. **Nezapisuje do `public.schema_migrations` vůbec.** → tohle je příčina toho,
   že evidence zamrzla na 339, zatímco schéma je u ~449.
2. **Aplikuje VŠECHNO při každém deployi**, bez kontroly stavu. Migrace jsou
   většinou idempotentní (`IF NOT EXISTS`), ale spoléhat na to není politika.
3. **Sahá jen na kořenový `migrations/`** (293 souborů, 001–437).
   `nextjs-boilerplate/migrations/` (74 souborů, **375–452**) **nikdy neaplikuje** —
   proto tam 450/451/452 nejsou.
4. **Bere i ne-migrace**: `BUNDLE_340-348_prod.sql`, `test_big_health_check.sql`,
   `test_delete_safety.sql`, `test_feature_interaction_audit.sql`.
5. **`psql` bez `ON_ERROR_STOP=1`** → vrací exit 0, i když příkazy uvnitř selžou.
   Krok v CI tedy **zezelená i po neúspěšné migraci**. Stejná třída jako tiché crony.

### Cesta 2 — `scripts/run-migrations.sh` — **jediná správná, ale nepoužívaná**

Zakládá tabulku jako `(filename TEXT PRIMARY KEY, applied_at TIMESTAMPTZ)`,
před aplikací kontroluje `WHERE filename = …`, pouští s `ON_ERROR_STOP=1`
a po úspěchu zapíše. **Tahle cesta vytvořila těch 245 řádků do 339** a od té doby
se zjevně nepoužila.

### Cesta 3 — `scripts/prod-migrate.mjs` + `nextjs-boilerplate/scripts/prod-migrate-runner.mjs`

Obě dělají `SELECT version FROM public.schema_migrations`, ale tabulka má
`filename`/`applied_at` → **42703**. U `prod-migrate.mjs:49` je to navíc obalené
`try{}catch{}`, které zaloguje *„tabulka neexistuje — předpokládám prázdnou DB"*
a pokračuje s **prázdnou množinou aplikovaných** → pokusilo by se aplikovat
úplně všechno od nuly. To není jen rozbité, to je nebezpečné.

### 🔎 Čtvrtá, nezdokumentovaná cesta — důkaz sporem

`orders.ticket_transfers` na produkci **existuje** (změřeno v BLOKU A, včetně
rozbitého `base64url` DEFAULTu). Vznikla migrací **416**, která leží **výhradně**
v `nextjs-boilerplate/migrations/`. Cesta 1 na tu složku nesahá, cesty 2 a 3
neběžely. → **Tu tabulku vytvořil někdo ručně** (psql / Neon konzole), mimo
jakoukoli evidovanou cestu. Přinejmenším část schématu tedy vznikla ad hoc.

### Důsledek pro deploy 450/451/452

Nasadit je dnešní CI cestou **nelze** — je v jiné složce, než na kterou workflow
sahá. Oprava runneru sama nestačí; musí se rozhodnout, **která složka je
kanonická** a sjednotit je (čísla 375, 435, 436, 437 se v obou překrývají —
u nich je potřeba ověřit, jestli jde o totéž).

**NEOPRAVENO** — tahle session skončila na diagnóze.

---

## §18 Otevřené riziko: RLS po baseline

`BUNDLE_340-348_prod.sql` zůstává v `migrations/` **záměrně**. Při každém deployi
dropne a znovu vytvoří **153 RLS policies** (v `BEGIN;…COMMIT;`, tedy atomicky).
Je to dnes **jediné, co drží RLS konzistentní** — proto se neodstraňuje spolu
s test skripty.

**Až se přejde na baseline, tahle pojistka zmizí.** Baseline obsahuje všech
**596 policies** (ověřeno, viz §19), ale aplikuje se jednou, ne při každém
deployi. Znamená to:

- drift RLS policy po deployi už nikdo automaticky nevrátí zpět
- **RLS bude potřebovat vlastní verifikaci** — např. porovnat `pg_policies`
  proti očekávanému seznamu jako součást deploy gate

Bez toho je odstranění BUNDLE regrese v bezpečnosti, ne úklid.

## §19 Baseline OVĚŘEN jako reprodukovatelný

Postup: klon produkční větve → `DROP SCHEMA … CASCADE` všech user schémat
(+ `DROP`/`CREATE` `public`, protože ho `pg_dump --schema-only` nevytváří —
čerstvá DB ho má vždy) → aplikace baseline → strojové porovnání.

```
                 produkce   klon po baseline
columns             6465          6465        0 rozdílů
indexes             2025          2025        0 rozdílů
policies             596           596        0 rozdílů
constraints         2392          2392        2 přerenderované
tabulky              607           607
```

**Jediný rozdíl jsou 2 CHECK constrainty**, a jde o renderování, ne o obsah:

```
produkce: CHECK (((transfer_policy)::text = ANY ((ARRAY['open'::varchar, …])::text[])))
klon:     CHECK (((transfer_policy)::text = ANY (ARRAY[('open'::varchar)::text, …])))
```

Povolené hodnoty jsou na obou stranách totožné (`events_transfer_policy_check`:
open/restricted/disabled; `orders_comp_type_check`: artist/other/press/sponsor/
staff/vip). Postgres výraz po round-tripu jinak normalizuje — známý artefakt
`pg_dump`, ne mezera.

**Vysvětlení 607 vs 599:** 607 = 600 `BASE TABLE` + 7 `VIEW`. Dřívější údaj
„dump má 599 tabulek" byl grep `^CREATE TABLE`, který o jednu podstřelil kvůli
formátování. Schéma mezeru nemá — dokazuje to 0 rozdílů ve sloupcích.

**Metodická poznámka:** předchozí pokus o tohle ověření vykázal „11478 rozdílů,
baseline není úplný". Bylo to **měření vlastní chyby** — `execSync` jde na
Windows přes `cmd.exe`, kde `&` v connection URI rozsekne příkaz, psql se
nespustil a porovnávalo se proti prázdnu. Opraveno `execFileSync` s polem
argumentů + tvrdou kontrolou „tabulek > 0" PŘED porovnáním.

### §19b Doplnění: triggery a sekvence (mezera v původním ověření)

Ověření v `8a2822c` porovnalo **4 dimenze** z šesti, které měly být porovnány —
`pg_trigger` a sekvence chyběly, a přesto byl commit pojmenován „OVĚŘENÝ".
Doplněno proti klonu obnovenému **z verze v repu** (ne ze scratchpadu):

```
                       produkce   klon po baseline
triggers (pg_get_triggerdef)  36        36     0 rozdílů
sequences (typ/start/inc/min/max/cycle) 15  15  0 rozdílů
seqOwners (sekvence → sloupec, pg_depend) 15 15  0 rozdílů
```

Guard potvrdil aplikaci před porovnáním: `tabulek=607, policies=596`.

`seqOwners` je tam schválně: kdyby baseline sekvenci vytvořil, ale neuvázal ji
k sloupci, `DEFAULT nextval(...)` by přestal fungovat a **žádná** ze čtyř
původních dimenzí by to nechytila. Sedí i to.

Pozn.: dřívější „14 CREATE SEQUENCE" byl opět grep, ne měření — reálně je jich
15 a strojové porovnání dává 15 = 15. Stejná třída nepřesnosti jako 599 vs 600
tabulek; ani jedno není mezera ve schématu.

**Souhrn ověření baseline — všech 6 dimenzí:**

| dimenze | rozdílů |
|---|---|
| columns | 0 |
| indexes | 0 |
| policies | 0 |
| triggers | 0 |
| sequences (+ vazby na sloupce) | 0 |
| constraints | 2 přerenderované, shodné povolené hodnoty |

---

## §20 ROZSAH OVĚŘENÍ BASELINE (jedno místo pravdy)

Aby to nikdo nemusel dolovat z commit messages. Commit `8a2822c` se jmenuje
„OVĚŘENÝ" a v době vzniku to bylo **nadsazené** — pokrýval 4 dimenze z šesti.
Doplněno v `bad9fe1`. Tenhle výčet platí.

### Co OVĚŘENÉ JE

Měřeno proti **klonu produkční větve**, vyprázdněnému `DROP SCHEMA … CASCADE`
(+ `DROP`/`CREATE public`), pak aplikován baseline a strojově porovnáno:

| dimenze | rozdílů |
|---|---|
| `information_schema.columns` (typ, nullable, default) | 0 |
| `pg_indexes` (plný `indexdef`) | 0 |
| `pg_policies` (qual, with_check, cmd) | 0 |
| `pg_trigger` (plný `pg_get_triggerdef`) | 0 |
| sekvence (typ/start/inc/min/max/cycle) | 0 |
| vazby sekvence → sloupec (`pg_depend`) | 0 |
| `pg_constraint` | **2 přerenderované** |
| extensions | 4 v baseline = 4 na produkci (+ `plpgsql`, implicitní) |

Ty 2 constrainty (`events_transfer_policy_check`, `orders_comp_type_check`)
se liší jen zápisem `ANY(...)` po round-tripu; povolené hodnoty jsou shodné.
**Rozhodnuto: v pořádku.**

### Co ověřené NENÍ

- **Obnova na čisté databázi.** Testováno výhradně na vyprázdněném klonu
  produkce, kde zůstaly role, extensions a cluster-level objekty. Restore
  na čerstvý Neon projekt **neproběhl**.
- **Že baseline sám stačí k funkční aplikaci.** Nestačí — viz §21.

## §21 Baseline NENÍ soběstačný recept

`000_baseline_20260730.sql` byl pořízen s `--no-owner --no-privileges`
(moje volba při dumpu). Grep to potvrzuje:

```
CREATE ROLE               0        CREATE EXTENSION            4
CREATE USER               0        CREATE SCHEMA AUTHORIZATION 0
GRANT                     0        OWNER TO                    0
ALTER DEFAULT PRIVILEGES  0        REVOKE                      0
```

Co na produkci existuje a baseline to nezaloží:

| objekt | rozsah | důsledek chybění |
|---|---|---|
| role `tixly_app` (`NOBYPASSRLS`, LOGIN) | 1 | aplikační role neexistuje |
| členství `neondb_owner` → `tixly_app` | 1 | owner se nedostane pod app roli |
| `USAGE` na schématech pro `tixly_app` | **78** | žádný přístup ke schématům |
| table granty pro `tixly_app` | **4200** na 77 schématech | žádné čtení ani zápis |
| default privileges (`EXECUTE` na budoucí funkce) | **234** | nové funkce bez práv |

**Klíčový důsledek:** obnova ze samotného baseline vytvoří kompletní schéma
včetně všech 596 RLS policies — a aplikace se přesto nedostane k jedinému
řádku, protože role, které se ta pravidla týkají, neexistuje. Schéma by
vypadalo správně a nefungovalo by.

Pozn.: `pg_policies.roles` je u všech 596 policies `{public}`, takže policies
samy na existenci `tixly_app` nezávisí — závisí na ní přístup.

**Doplněno:** `migrations/000_baseline_globals.sql` (511 řádků) — role, členství,
78× `GRANT USAGE ON SCHEMA`, 77× `GRANT … ON ALL TABLES`, granty na sekvencích,
234× `ALTER DEFAULT PRIVILEGES`. **Nepouštěno na produkci.**

⚠️ **Heslo role `tixly_app` z `pg_roles` vyčíst nejde** — soubor na to má
komentář a `ALTER ROLE … PASSWORD` se musí doplnit ručně.

⚠️ Soubor je **vygenerovaný, ne otestovaný**: restore `baseline` + `globals`
na čistou DB neproběhl.

## §22 Deploy-order — TVRDÁ ZÁVISLOST

**RLS verifikace musí být v deploy gate DŘÍV, než `BUNDLE_340-348_prod.sql`
zmizí z deploy cesty.**

BUNDLE dnes při každém deployi dropne a znovu vytvoří 153 RLS policies
(atomicky, v `BEGIN;…COMMIT;`) a je **jediné, co RLS drží konzistentní**.
Baseline všech 596 policies obsahuje, ale aplikuje se **jednou** — drift po
deployi už nikdo automaticky nevrátí. Odstranit BUNDLE bez náhradní verifikace
= bezpečnostní regrese, ne úklid.

Pořadí (žádný krok nepřeskakovat):

1. `000_baseline_20260730.sql` + `000_baseline_globals.sql` (v tomhle pořadí)
2. mig **450** → **451** → **452**
3. capacity backfill
4. **RLS verifikace do deploy gate** ← tvrdá závislost
5. teprve pak odstranit `BUNDLE_340-348_prod.sql`

---

## §23 Granty: uvnitř schémat uniformní, ale 7 tabulek grant NEMÁ

Měřeno na produkci per tabulka (`information_schema.role_table_grants`):

- **77/77 schémat uniformních** — všechny tabulky s grantem mají tutéž sadu
  `DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE`
- **ALE 7 base tabulek nemá grant vůbec**: `communications.broadcasts`,
  `communications.emergency_announcements`, `communications.announcement_responses`,
  `brands.advertisers`, `brands.campaigns`, `brands.event_partnerships`,
  `brands.impressions`

→ `GRANT … ON ALL TABLES IN SCHEMA` (v1 globals) by jim práva **PŘIDAL**.
To je rozšíření oprávnění, ne obnova. **Globals přegenerovány PER TABULKU**
(600 příkazů). Přesnost > délka souboru.

Sekvence: uniformní, reálná práva `rwU` = **SELECT, UPDATE, USAGE** — v1 psal
jen `USAGE, SELECT`, chyběl UPDATE. Opraveno.
Funkce: 17 má explicitní grant; v1 je neměl vůbec. Doplněno.

> 🔎 Vedlejší nález: `communications.broadcasts` grant nemá, přestože do ní
> aplikace zapisuje (`admin/broadcasts:76`, opraveno v `63fd1d4`). Pod
> `tixly_app` by ten INSERT skončil na **42501 insufficient_privilege**.
> Sken ani guard to nevidí — oba běží jako `neondb_owner`. **Neověřeno naživo.**

## §24 Test dvojice baseline+globals na „čisté" DB — NÁHRAŽKA

**Čerstvý Neon projekt nelze**: `HTTP 404 project-scoped keys are not allowed
to create projects`. Použit klon, ze kterého odstraněna schémata, role
`tixly_app` i extensions (výchozí stav: `tabulek=0 role=0 extensions=1`).
**Není to plný test čisté DB** — role clusteru a Neon systémové objekty zůstaly.

**Pořadí:** zadání říkalo globals → baseline. **Je to obráceně.** Globals
udělují granty na objekty, které musí existovat dřív. Správně
**baseline → globals**; ověřeno během (obojí `OK`, `tabulek=607 policies=596`).

### Strukturální porovnání: 3 rozdíly z 9 dimenzí

| dimenze | rozdílů |
|---|---|
| columns, constraints, indexes, policies, triggers, sequences, roles, extensions | **0** |
| grants | **3 chybí** |

Chybějící granty jsou všechny PostGIS pohledy: `public.geography_columns`,
`public.geometry_columns`, `public.spatial_ref_sys`. **Proč se neaplikovaly,
jsem nezjistil** — jsou v globals vygenerované a psql skončil bez chyby.

### Funkční test jako `tixly_app`

```
připojen jako: tixly_app (bypassrls=false)
✅ SELECT identity.users → 0 řádků
❌ INSERT → 42501 new row violates row-level security policy for table "users"
```

**To odmítnutí je správné chování, ne vada receptu.** Připojil jsem se surově,
bez `SET LOCAL app.role`/`app.*` GUC, které aplikace nastavuje přes `rls-pool`.
RLS zafungovalo. Dokázáno tím: role existuje a přihlásí se, granty fungují
(SELECT neskončil na 42501 kvůli právům), RLS je aktivní a vynucuje se.

**NEDOKÁZÁNO:** že se stejným INSERTem *s* korektním GUC kontextem projde.
Ten test jsem nespustil.

---

## §25 GUC test — recept je FUNKČNĚ ověřený

Na klonu obnoveném z `baseline` + `globals`, připojen jako `tixly_app`
(`current_user=tixly_app session_user=tixly_app bypassrls=false`):

```
A) BEZ GUC          → 42501 new row violates row-level security policy  ✅ RLS blokuje
B) SET LOCAL app.role='service'
   INSERT identity.users → ✅ PROŠEL, id=d8d4f99b-…
   zpětné čtení          → ✅ 1 řádek
```

GUC podle `rls-pool.ts:145-154` (`app.current_promoter_id`, `app.is_platform_admin`,
`app.current_user_id`, `app.role`); `runWithServiceContext` používá `app.role='service'`
→ `app_is_service()`.

**Verdikt: dvojice `baseline` + `globals` vytvoří DB, kde se aplikační role
připojí, podléhá RLS a se správným kontextem zapíše.** To je ten test, který
minule chyběl.

## §26 Schémata `communications` a `brands` jsou pro aplikaci ZAVŘENÁ

Pod `tixly_app` (s korektním kontextem):

```
communications.broadcasts : 42501 permission denied for schema communications
brands.advertisers        : 42501 permission denied for schema brands
```

Není to „7 tabulek bez grantu" — **celá dvě schémata nemají ani `USAGE`**.
(Globals generují 78 `GRANT USAGE ON SCHEMA`, protože přesně tolik schémat má
`tixly_app` v `nspacl`; `communications` a `brands` mezi nimi nejsou.)

🔴 **Korekce mého vlastního tvrzení:** commit `63fd1d4` „opravil"
`admin/broadcasts:76` (odstranění neexistujícího `sent_by_user_id`). Ta oprava
je správná na úrovni SQL, ale **cestu nezprovozní** — pod aplikační rolí padne
dřív, na `42501 permission denied for schema communications`. Totéž platí pro
`emergency_announcements`, `announcement_responses` a čtyři tabulky v `brands`.

**NEZMĚŘENO:** jestli je to záměr (mrtvý subsystém) nebo chybějící grant.
Neopravuji — vyžaduje rozhodnutí.

## §27 PostGIS granty: příčina nalezena, z globals odstraněny

`ON_ERROR_STOP=1` **byl** nastaven. Ty 3 granty ale nevrátily error, nýbrž:

```
WARNING: no privileges were granted for "geography_columns"
WARNING: no privileges were granted for "geometry_columns"
WARNING: no privileges were granted for "spatial_ref_sys"
```

Příčina: ty objekty vlastní `cloud_admin` a patří extensioně
(`pg_depend deptype='e'`), takže `neondb_owner` na ně grant udělit **nemůže**.
Postgres to hlásí jako WARNING, ne ERROR → `ON_ERROR_STOP` to nechytí.

→ Dřívější „3 rozdíly" **nebylo podhodnocené**, byly přesně 3 a příčina je známá.
→ Granty na ty pohledy **z globals odstraněny** — reprodukovat je nelze
a produkce je má z jiného zdroje (pravděpodobně od `cloud_admin`).

---

## §28 Pod jakou rolí běží produkce — NEJDE ROZHODNOUT (a proč)

### Co je změřené

**Neon API, role na větvi `br-rough-paper-alom0zky`:**
```
neondb_owner   (created 2026-05-20)
tixly_app      (created 2026-06-01)     ← Neon-managed role, existuje
```

**`pg_roles`:**

| role | LOGIN | BYPASSRLS | SUPER |
|---|---|---|---|
| `cloud_admin` | ✅ | ✅ | ✅ |
| `neon_service` | ✅ | ✅ | — |
| `neon_superuser` | — | ✅ | — |
| `neondb_owner` | ✅ | **✅** | — |
| `tixly_app` | ✅ | **❌** | — |

**`pg_stat_activity`:** jediné spojení = **moje vlastní** (`neondb_owner`,
`client 10.34.32.201/32`, dotaz = tenhle audit). **Žádné spojení od aplikace.**
Endpoint `ep-weathered-wind-alvbjysw`: `state=idle`, `last_active=2026-07-30T21:09`.

**Proč tam aplikace není:**
```
identity.users : 3 řádky
orders.orders  : 0 řádků
catalog.events : 0 řádků
```
Produkční DB **nemá žádný provoz** — 0 akcí, 0 objednávek. Konzistentní
s tím, že projekt je předprodukční.

### Verdikt: **NEJDE ROZHODNOUT**

`pg_stat_activity` nemůže odpovědět, protože **aplikace není a nikdy nebyla
připojená**. Nedokazuje to ani inertnost RLS, ani jeho vynucování.

**Indicie, že `tixly_app` JE zamýšlená aplikační role** (indicie, ne důkaz):
- je Neon-managed (figuruje v API seznamu rolí), tedy někdo ji vědomě založil
- je **jediná** role s `BYPASSRLS = false` — u ostatních by RLS nedávalo smysl
- má 4200 table grantů a 78 schema `USAGE` grantů výhradně pro sebe

**Co chybí k rozhodnutí a jak to získat:**
1. hodnota `DATABASE_URL` v produkčním prostředí Vercelu → `vercel env pull`
   (CLI **není nainstalované**: `npm i -g vercel`) nebo Vercel dashboard
2. NEBO zachytit aplikaci připojenou — dnes nelze, DB je bez provozu

**Netipuju.** Dokud se nepřečte to URI, není doloženo ani „RLS se vynucuje",
ani „RLS je inertní".

> ⚠️ Kdyby produkce jela jako `neondb_owner`, je RLS **inertní** (bypassrls=true)
> a všech 596 policies je dekorace. To je scénář, který se **nedá vyloučit**
> a stojí za jedno přečtení env proměnné.

## §29 🕶️ Slepá třída: `WARNING` není `ERROR`

`ON_ERROR_STOP=1` chytá **jen ERROR**. Postgres hlásí řadu neúspěchů jako
WARNING a psql pokračuje s exit 0. Doloženo na PostGIS grantech (§27):
```
WARNING: no privileges were granted for "geography_columns"
→ psql exit 0, přesto grant NEudělen
```
**Důsledek pro budoucí deploy runner:** „migrace proběhla (exit 0)" **neznamená**
„efekt nastal". Runner musí buď parsovat warningy, nebo — spolehlivěji —
po aplikaci **porovnat schéma proti očekávání**, ne věřit exit kódu.
Je to táž třída jako tiché crony (§8) a `psql` bez `ON_ERROR_STOP` v `deploy.yml`
(§17), jen o patro výš.

## §30 🕶️ Slepá třída: všechna dosavadní měření běžela jako `neondb_owner`

Sken, guard, všechny RED→GREEN harnessy i live testy se připojují jako
`neondb_owner` — role s **`BYPASSRLS = true` a bez potřeby grantů**.

**Všechny dosavadní výsledky jsou proto systematicky OPTIMISTICKÉ o celou
vrstvu oprávnění.** Cesta, která u nás „PROŠLA", může pod aplikační rolí
skončit na `42501` — buď chybějícím grantem, nebo RLS policy.

Doloženo: `communications.broadcasts` a `brands.advertisers` jsou pod
`tixly_app` nedostupné (`42501 permission denied for schema`), a **žádné**
z našich měření to nezachytilo (§26).

**Rozsah: ZMĚŘEN** (2026-08-04). Obě vrstvy přeměřeny pod `tixly_app`:

| vrstva | nástroj | zkreslení | stav |
|---|---|---|---|
| granty | schema-reality-scan (§33) | +6 nálezů, 140 → 146 = **0,25 % dotazů** | 🟢 uzavřeno |
| RLS | live sada (§31) | **6 z 30 testů = 20 %** | 🔴 otevřeno |

Vrstvy se **nepřekrývají** — live sada nechytila ani jeden grantový pád, sken
ani jeden RLS pád. Grantová vrstva je tím vyčerpaná (mimo `communications`
a `brands` nechybí jediný grant). RLS zůstává změřená jen na 30 testech.

---

## §31 §30 ZMĚŘENO: pod `tixly_app` padá 6 z 30 live testů (20 %)

Live sada pod dvěma rolemi, jinak identická (`LIVE_AS_APP_ROLE=1`):

```
neondb_owner (BYPASSRLS=true) : 5 files passed, 30 passed | 1 skipped, exit 0
tixly_app    (BYPASSRLS=false): 1 file FAILED, 6 failed / 24 passed, exit 1
```

**Zkreslení §30 je tedy 20 % live sady.** Všech 6 pádů je v
`admin-guest.live.test.ts` a mají JEDNU společnou příčinu:

```
new row violates row-level security policy (USING expression) for table "users"
  at createOrGetGuestUser (src/lib/identity/guest-user.ts:130)
  at admin/events/[id]/comps/route.ts:175
```

🔴 **Padá SDÍLENÝ guest-create helper.** `ON CONFLICT … DO UPDATE` musí projít
i **USING** výrazem RLS policy nad existujícím řádkem, a kontext admin cest
(`runAsActivePromoter` → `app.role='promoter'`, `app.current_promoter_id`)
na `identity.users` nestačí.

Dopad je širší než 6 testů: helper má **7 přepojených call-sites** a čeká na něj
**18 nepřepojených kopií** (REMEDIATION §1). Pod produkční rolí je tedy dnes
rozbitá celá guest-create třída na admin cestách.

`checkout-guest.live.test.ts` (4 testy) **prošel** — checkout jede v jiném
kontextu. Rozdíl mezi nimi je ta hranice, kterou je potřeba pochopit.

**NEOPRAVENO** — je to nový front, ne úklid.

### Co tohle číslo NEPOKRÝVÁ

20 % je zkreslení **live sady**, ne celého systému.

> ⚠️ **KOREKCE (§33, 2026-08-04):** původně tu stálo, že sken pod `tixly_app`
> spustit nelze, protože `information_schema` filtruje podle oprávnění.
> **To je vyvrácené** — sken introspektuje přes `pg_catalog`, obě role vidí
> 600 tabulek a běhy srovnatelné jsou. Sken byl spuštěn a dal **+6 nálezů**
> (140 → 146), všechny třídy T0 a všechny na `communications`/`brands`.
> Skutečné zkreslení je tedy: granty **uzavřené**, RLS **stále neznámé**
> za hranicí 30 live testů.

## §32 `communications` a `brands`: 13 route souborů na mrtvých schématech

Obě schémata nemají pro `tixly_app` ani `USAGE` (§26). Kód, který na nich stojí:

**`communications` — 5 souborů:** `admin/broadcasts`, `admin/broadcasts/[id]/preview`,
`admin/broadcasts/[id]/send`, `admin/events/[id]/emergency`,
`buyer/announcements/[token]/respond`

**`brands` — 8 souborů:** `admin/brand-connect/proposals`,
`admin/brand-connect/proposals/[id]`, `brand-connect/event/[id]`,
`brand-connect/track`, `platform/brand-connect/advertisers`,
`platform/brand-connect/campaigns`, `platform/brand-connect/campaigns/[id]`,
`platform/brand-connect/campaigns/[id]/match`

**Rozhodnutí, které je potřeba udělat:**
- **udělit granty** (`GRANT USAGE ON SCHEMA` + table granty) — pokud jsou
  brand-connect a broadcasts živé featury, které mají fungovat
- **vypnout je vzorem foyer** (UI flag + backend guard) — pokud jsou mrtvé

13 route souborů je dost na to, aby to nebylo triviální ani jedním směrem.

---

## §33 SKEN pod `tixly_app` ZMĚŘEN: +6 nálezů třídy T0, grantová vrstva UZAVŘENA

§31 tvrdilo, že sken pod aplikační rolí spustit nelze, protože
`information_schema` filtruje podle oprávnění → „výsledek by nebyl srovnatelný".
**To tvrzení je vyvrácené.** Sken introspektuje přes `pg_catalog`, ne přes
`information_schema`, takže obě role vidí tentýž počet tabulek a běhy
srovnatelné JSOU:

```
klon: 000_baseline_20260730.sql + 000_baseline_globals.sql do PRÁZDNÉ databáze
      → 81 schémat | 600 tabulek | 596 policies

neondb_owner : schéma 600 tabulek | T0=2 T1=41 T2=20 T3=6 T4=59 T5=12 → 140
tixly_app+GUC: schéma 600 tabulek | T0=8 T1=41 T2=20 T3=6 T4=59 T5=12 → 146
```

**Delta: +6, výhradně v T0. Nic nezmizelo** (0 nálezů ubylo), ostatní třídy
jsou identické do jednoho kusu.

### Nová třída: „tabulka existuje, ale aplikační role ji nevidí"

Všech 6 nových T0 je sken hlásí jako `42P01 tabulku nelze najít` — ale ony
existují. Pod `tixly_app` jen nejsou v dohledu, protože schéma nemá `USAGE`:

```
src/app/api/admin/broadcasts/route.ts:85                     communications.broadcasts
src/app/api/admin/events/[id]/emergency/route.ts:108         communications.emergency_announcements
src/app/api/brand-connect/track/route.ts:28                  brands.impressions
src/app/api/platform/brand-connect/advertisers/route.ts:43   brands.advertisers
src/app/api/platform/brand-connect/campaigns/route.ts:54     brands.campaigns
src/app/api/platform/brand-connect/campaigns/[id]/match:106  brands.event_partnerships
```

Sken tedy **nezávisle znovuobjevil §26** — a poprvé ho ukázal jako nálezy
v kódu, ne jako ruční sondu.

### Grantová vrstva je tím UZAVŘENÁ (na rozdíl od RLS)

Ověřeno dotazem na katalog, ne odhadem:

```
schémat bez USAGE pro tixly_app                        : 2  (communications, brands)
tabulek v nich                                         : 7  (3 + 4)
tabulek bez SELECT ve VŠECH ostatních schématech       : 0
app vidí sloupců v communications/brands (info_schema) : 0
app vidí tabulek celkem (information_schema)           : 791
```

🟢 **Mimo ta dvě schémata nechybí `tixly_app` ani jeden grant.** „7 tabulek bez
grantu" z §26 není vzorek většího problému — je to problém celý. Grantová
vrstva už není otevřené riziko, je změřená a ohraničená.

🔴 **RLS vrstva ohraničená NENÍ.** Sken je statický a o RLS neříká nic (píše to
sám ve FALSE NEGATIVES). Jediné, co RLS měří, je live sada — 30 testů.
Za jejich hranicí zůstává 596 policies nezměřených.

### Vedlejší nález: baseline se přes `node-pg` neaplikuje

`000_baseline_20260730.sql` obsahuje 2 psql meta-příkazy z `pg_dump` 17
(`\restrict` / `\unrestrict`, řádky 5 a 44985). Přes SQL driver dají
`42601 syntax error at or near "\"` a **celý baseline se neaplikuje**.
Buď `psql`, nebo je runner musí odfiltrovat. Po odfiltrování baseline projde
čistě (5,6 s) a globals na něj navážou (0,1 s) — recept je funkční, ale
**není spustitelný „jak leží"**.

---

## §34 RLS ZMĚŘENA: 596 policies = 64 vzorců; 14 účinných, 12 odepírá všechno, 7 děravých

Poslední neměřená vrstva. Sčítání (`scripts/rls-policy-census.mjs`) + empirický
test izolace (`scripts/rls-isolation-test.mjs`) na klonu z baseline.

### Sčítání

```
policies celkem            : 596
DISTINKTNÍCH VZORCŮ        : 64      ← netestuje se 596×, testuje se 64 tvarů
tabulek s ENABLE RLS       : 411
role, na které policies míří: {public} → 596 ze 596
```

🟢 **Otázka „411 ENABLE vs 596 policies" je zodpovězená: NENÍ to nesoulad.**
Policies na tabulce BEZ `ENABLE ROW LEVEL SECURITY`: **0**.
Tabulek s `ENABLE RLS` a bez jediné policy (tiché deny): **0**.
Rozdíl je prostě víc policies na jednu tabulku. Žádná policy není mrtvá tímhle
způsobem — a všech 596 míří na `{public}`, takže na `tixly_app` **platí**.

### 🔴 Name-drift GUC: 7 nastavení, která policies čtou a aplikace NIKDY nenastaví

`rls-pool.ts:145-154` nastavuje: `app.current_promoter_id`, `app.current_user_id`,
`app.is_platform_admin`, `app.role`. Všechna čtyři někdo čte — dobře.
Opačným směrem je to horší:

```
app.bypass_rls       13 policies      app.promoter_id      10 policies
app.user_id          10 policies      app.is_service        4 policies
app.is_admin          2 policies      app.use_service_role  2 policies
app.platform_admin    1 policy
```

Celkem **42 policies čte nastavení, které nikdy nikdo nenastaví**. Nejde
o bezpečnostní díru (fail-closed), ale o **funkční** — predikát nemůže být
nikdy pravdivý, takže policy jen odepírá.

Pozor na dva různé tvary:
- `current_setting('app.bypass_rls', true) = 'on'` → porovnání textu, nikdy
  nesedí → **mrtvé, ale bezpečné**
- `(current_setting('app.promoter_id', true))::uuid` → **přetypování**. Když je
  GUC nenastavené, vrací `NULL` (v pořádku); když je nastavené na prázdný
  řetězec — což je doložený stav po `RESET` (T-AUDIT-GUC) — je to `''::uuid`
  → **22P02 a dotaz spadne**. Tohle je runtime chyba, ne jen mrtvý kód.

### Test izolace: dva tenanti, `tixly_app` s GUC tenanta A

58 reprezentativních tabulek (jedna na vzorec + všech 12 `USING (true)`):

| verdikt | počet | co to znamená |
|---|---|---|
| 🟢 izolace funguje | **14** | vidí vlastní řádek, cizí NE |
| 🔴 děravé | **7** | vidí i cizí řádek |
| ⛔ odepírá všechno | **12** | nevidí **ani vlastní** řádek |
| ⚪ neměřeno | **25** | seed neprošel (FK/CHECK řetěz) |

⛔ **„Vidí 0 z 2" NENÍ důkaz izolace** — je to důkaz, že aplikace nedosáhne ani
na vlastní data. Původně jsem to počítal jako úspěch; je to chyba v opačném
směru. 6 z těch 12 sedí přesně na name-drift GUC výše:

```
identity.magic_link_tokens  ← app.user_id        payments.wero_payments   ← app.promoter_id, app.is_admin
orders.box_office_sales     ← app.user_id        payments.wero_webhooks   ← app.promoter_id, app.is_admin
orders.seat_upgrades        ← app.user_id        catalog.venue_gates      ← app.promoter_id, app.is_service
```

### 🔴 Děravé (7)

Pět je `SELECT USING (true)` nad číselníky, kde je veřejné čtení nejspíš záměr
(`travel_hotels`, `travel_hotel_rooms`, `postal_fees`, `carbon_offset_settings`,
`platform.promoters`) — ale **záměr to nikde neříká**, takže to zůstává nález.

🔴 **`identity.users` je jiná liga.** Policy `p_users_select` je
`PERMISSIVE SELECT USING (true)` — a protože se permissive policies OR-ují,
přebije obojí zbývající policy. Každé připojení s jakýmkoli GUC kontextem
přečte **všechny řádky**.

> 🔧 **KOREKCE vlastního tvrzení:** původně jsem sem napsal, že uniká i
> `password_hash`. **To bylo ŠPATNĚ.** Migrace 335 (commit `5caf7c0`) hash
> přesunula do `identity.user_secrets` s vlastní striktní policy
> `p_user_secrets_scope`, kterou můj vlastní test izolace změřil jako
> **ÚČINNOU**, a trigger `trg_move_password` sloupec v `users` po každém zápisu
> vynuluje (ověřeno na klonu: `user_secrets=1`, `users.password_hash=NULL`).
> Login proto JOINuje `user_secrets`. Sloupec v `users` existuje, ale je prázdný.

Uniká tedy **PII, ne přihlašovací údaje**:

```
email, phone, name, birth_year, gender, country_code, city, postal_code,
stripe_customer_id
```

Změřeno, ne odvozeno: tenant A viděl řádky tenanta B.

**A NEBYL to omyl.** `USING (true)` zavedla mig 335 vědomě: „identity.users měla
RLS=off, protože 91 routes JOINuje users kvůli jménu/emailu. Naivní restriktivní
RLS by je rozbila." Dnes je těch JOINů **126 ve 149 souborech** — tlak je větší,
ne menší. Proto se to nedá jen smazat; viz migrace 453 (§37).

### Co číslo NEPOKRÝVÁ

25 z 58 vzorců je **NEMĚŘENO** — seed neprošel přes FK/CHECK řetěz
(`event_seats`, `ticket_types`, `resale_listings`, `event_reviews` a další).
Není to „v pořádku", je to **nezměřeno**. Mezi nimi zůstávají i 2 z 3 policy
typu `UPDATE USING (true)` bez `WITH CHECK` (`ticket_transfers`,
`ticket_alerts`) — třetí (`seat_upgrades`) se změřit podařilo a odepírá.

## §35 🔴 DEPLOY BLOCKER: `base64url` nefunguje na ŽÁDNÉ vydané verzi Postgresu

Odhaleno mimochodem, při seedu — žádný z našich nástrojů to nehledal.

```
server_version : 17.10        encode('abc','base64url') → 22023 unrecognized encoding
```

`base64url` v `encode()` přibyl až v **PostgreSQL 19** (commit `e1d91718`) —
a ta **zatím nevyšla**. Není to tedy „stará větev Neonu": ten výraz nefunguje
**nikde, na žádné existující verzi Postgresu**. Shodně s korekcí u §-ticket
transfers výše; moje první formulace „od PG 18" byla ŠPATNĚ.
Tři sloupce ho mají v `DEFAULT`:

```
marketing.ticket_alerts.token          = encode(gen_random_bytes(16),'base64url')
orders.party_split_sessions.share_token = encode(gen_random_bytes(18),'base64url')
orders.ticket_transfers.transfer_token  = encode(gen_random_bytes(24),'base64url')
```

A aplikace ten token **nedodává** — spoléhá na default a čte ho zpátky:

```
api/events/[id]/alert/route.ts:38          INSERT … (email, event_id, user_id, alert_type) … RETURNING token
api/my/tickets/[ticketId]/transfer:102     INSERT … (ticket_id, from_user_id, to_email) … RETURNING token
api/checkout/party-split/route.ts:105      INSERT INTO orders.party_split_sessions …
```

🔴 Takže **tři zákaznické cesty dnes na produkci spadnou na 500**: hlídací pes
na lístky, převod lístku a rozdělení platby ve skupině. Není to RLS ani grant —
je to verze Postgresu. **NEOPRAVENO.**

## §36 Pokrytí nástrojů: co který vidí a co nevidí ANI JEDEN

Tři nástroje, tři různé vrstvy. Žádný nevidí to, co ostatní — a proto „zelený"
kterýkoli z nich nikdy neznamená „v pořádku".

| nástroj | vrstva | vidí | NEVIDÍ |
|---|---|---|---|
| `schema-drift-guard` | parse | `42703`, `42P01` — sloupec/tabulka neexistuje | cokoli, co se vyhodnotí až při běhu |
| `schema-reality-scan` | schéma | `23502`, `42P10`, `23514`, chybějící granty | RLS, data, defaulty, dynamické SQL |
| live sada | běh | RLS, GUC kontext, skutečné cesty | jen 30 testů — zbytek systému mimo |
| `rls-policy-census` + `rls-isolation-test` | RLS | tvar policy, tenant izolace | 25 z 58 vzorců (seed neprošel) |

**Doloženo tím, jak se nálezy nepřekrývaly:** grantovou vrstvu (§33) našel jen
sken, RLS vrstvu (§31, §34) jen běh, a `base64url` (§35) **nenašel ani jeden** —
vypadlo to při seedu testu, který hledal něco úplně jiného.

### Co nevidí ANI JEDEN nástroj

- **Dynamicky skládané SQL** — 135 dotazů. Extraktor vidí jen `head` před
  prvním `${…}`. Nezkontrolované, nezměřené, ani jednou.
- **`42P08` / nesoulad typů parametrů** — nikdo netestuje typy `$1..$n`.
- **WARNING místo ERROR** — `GRANT` na cizí objekt vrátí WARNING a `ON_ERROR_STOP=1`
  ho NEchytí (§27). Tichý „úspěch" je nejhorší třída.
- **Oprávnění na úrovni SLOUPCŮ** — všechno měříme na úrovni tabulky.
  `GRANT SELECT (col)` by nikdo nezaznamenal.
- **Verze Postgresu vs. použité funkce** — přesně `base64url` (§35).
  Nikdo neporovnává, co schéma volá, s tím, co server umí.
- **Defaulty a generované sloupce** — sken je nevyhodnocuje; vybuchnou až při
  `INSERT` (a §35 ukazuje, že to není teorie).

---

## §37 Migrace 453: `p_users_select` zúžena — RED→GREEN doloženo

Náhrada `USING (true)` za pět větví (vlastní řádek + service/admin + obchodní
vztah). Test `scripts/test-453-users-select.mjs` na klonu z baseline,
připojení jako `tixly_app`:

| sonda | RED (dnes) | GREEN (453) |
|---|---|---|
| promotér A vidí řádek tenanta B | 1 🔴 ÚNIK | **0 ✅** |
| promotér A vidí cizího člověka | 1 🔴 ÚNIK | **0 ✅** |
| promotér A vidí svého zákazníka | 1 ✅ | **1 ✅** |
| promotér A vidí člena svého týmu | 1 ✅ | **1 ✅** |
| admin JOIN (tvar ze 126 rout) | 1 ✅ | **1 ✅** |
| login (service + `user_secrets`) | 1 ✅ | **1 ✅** |
| guest-create `ON CONFLICT` | OK ✅ | **OK ✅** |
| buyer vidí vlastní řádek | 1 ✅ | **1 ✅** |

Únik se zavřel a **žádná z 6 legitimních cest se nerozbila**.

⚠️ Dvě věci, které tenhle test NEDOKAZUJE:
- **Výkon.** Policy má dvě `EXISTS` větve nad `orders`→`events` a vyhodnocuje se
  na každý řádek. Klon je prázdný, takže se to tu nezměří. Před nasazením
  `EXPLAIN` na největším promotérovi.
- **Že 126 JOIN sites je pokryto.** Test ověřil JEDEN tvar JOINu, ten nejčastější.
  Zbylých 125 míst může číst `users` i jinudy (např. přes `tickets` bez
  `orders`, nebo u uživatelů bez objednávky). To je **NEZMĚŘENO**.

### Chyby v mém vlastním testu (než dal správný výsledek)

Dvě kola falešně červené, obě moje:
1. `catalog.venues.city` je `NOT NULL` → seed spadl → chyběl řetěz
   `venue→event→order`, takže větev „zákazník promotéra" neměla co najít.
   Vypadalo to jako rozbitá policy, byl to rozbitý seed.
2. `ON CONFLICT (email)` → `42P10`. Arbiter je **částečný** index
   `uq_identity_users_email_active … WHERE anonymized_at IS NULL` a predikát
   se musí zopakovat — přesně jak to dělá `guest-user.ts:133`. Kdybych se
   nepodíval do kódu, hlásil bych „453 rozbila guest-create".

---

## §38 Name-drift GUC: přesná mapa, a proč se MUSÍ opravit strana policies

`scripts/rls-guc-map.mjs`, změřeno na klonu z baseline.

### Mapa

| GUC | policies | nastavuje aplikace? | jak se čte |
|---|---|---|---|
| `app.is_platform_admin` | 37 | ✅ | přes `app_is_platform_admin()` |
| `app.current_user_id` | 19 | ✅ | přes `app_current_user_id()` |
| `app.current_promoter_id` | 6 | ✅ | přes `app_current_promoter_id()` |
| `app.role` | 0 | ✅ | přes `app_is_service()` |
| `app.bypass_rls` | 13 | 🔴 **NE** | přímo v policy |
| `app.promoter_id` | 10 | 🔴 **NE** | přímo v policy |
| `app.user_id` | 10 | 🔴 **NE** | přímo v policy |
| `app.is_service` | 4 | 🔴 **NE** | přímo v policy |
| `app.is_admin` | 2 | 🔴 **NE** | přímo v policy |
| `app.use_service_role` | 2 | 🔴 **NE** | přímo v policy |
| `app.platform_admin` | 1 | 🔴 **NE** | přímo v policy |

🔧 **Korekce mého čísla z §34:** psal jsem „42 policies". Správně je
**39 unikátních policies** — 42 byl součet přes jména, a některé policies čtou
dvě nenastavovaná jména najednou.

Vzorec je viditelný: **co jde přes `app_*()` funkce, to funguje; co sahá na
`current_setting()` přímo, to je rozbité.**

### Směr sjednocení: opravit POLICIES. Opačný směr NELZE.

Nabízí se „levnější" varianta — doplnit 7 aliasů do `rls-pool.ts` (7 řádků
místo migrace nad 39 policies). **Ta varianta je ale nepoužitelná**, a ne
z estetických důvodů:

🔴 **5 ze 7 jmen nejsou identita, ale ZVÝŠENÍ OPRÁVNĚNÍ:** `app.bypass_rls`,
`app.is_admin`, `app.platform_admin`, `app.is_service`, `app.use_service_role`.
Kdyby je `rls-pool` začal nastavovat, izolaci by to **neobnovilo, ale vyplo** —
`app.bypass_rls = 'on'` je doslova bypass a sedí na 13 tabulkách.

Zbylá 2 (`app.promoter_id`, `app.user_id`) jsou skutečné aliasy identity, kde by
alias smysl dával — ale kvůli přetypování níže by problém stejně nevyřešil.

**Historie potvrzuje, která strana je kanonická:**

```
mig 285 / 303 / 310  → zavedly app_current_promoter_id(), app_is_service()… (konvence)
rls-pool.ts          → 20f5857, b1cfe14 (Fáze 2 foundation); naposledy 2026-06-03
mig 236_wero_payments → app.is_admin  = STARŠÍ než konvence (legacy, nikdy nepřevedeno)
mig 385b / 404 / 420  → app.promoter_id, app.bypass_rls, app.user_id
                        = NOVĚJŠÍ než konvence (drift vznikal dál)
```

Konvence tedy existuje od mig 285 a `rls-pool` ji dodržuje. Rozjely se pozdější
migrace, ne aplikace. **Opravit se má 39 policies, na `app_*()` funkce.**

### 🔴 Podtřída 22P02 — a je obráceně, než jsem čekal

Přetypovaných výskytů: **13**. Rozdělení je to podstatné:

| kde | počet | co se stane při prázdném řetězci |
|---|---|---|
| na **nenastavovaném** jménu | 9 | GUC je `NULL` → `NULL::uuid` = `NULL` → **fail-closed** |
| na **nastavovaném** jménu | 4 | ⚠️ **`''::uuid` → 22P02 → 500** |

Nebezpečné **nejsou** ty osiřelé — ty aplikace nikdy nenastaví, takže zůstanou
`NULL`. Nebezpečné jsou ty čtyři, které sahají na `app.current_user_id`, tedy
GUC, který aplikace **reálně nastavuje** a po `RESET` z něj zůstane prázdný
řetězec (doloženo dřív jako T-AUDIT-GUC):

```
⚠️ catalog.scanner_devices    platform_admin_devices   (current_setting('app.current_user_id',true))::uuid
⚠️ catalog.scanner_devices    promoter_own_devices     — dtto
⚠️ identity.oauth_accounts    oauth_accounts_own       — dtto
⚠️ lineups.artist_follows     artist_follows_own       — dtto
```

Proč zrovna ony: **obcházejí helper.** `app_current_user_id()` dělá
`NULLIF(current_setting(…), '')::uuid` — tedy prázdný řetězec ošetřuje. Tyhle
čtyři castují napřímo, bez `NULLIF`. **Každá je potenciální 500, ne fail-closed.**

🟡 Zbylých 21 výskytů je porovnání s textem (`app.bypass_rls = 'on'`,
`app.is_service = 'true'`…) — nikdy nesedí, tedy mrtvé, ale bezpečné.

**NEOPRAVENO** — na tomhle kroku mělo být jen zmapování.

---

## §39 Migrace 454: přímý cast GUC → 22P02 potvrzeno i po `RESET`

Čtyři policies castovaly `app.current_user_id` napřímo, bez `NULLIF`.
Migrace je převádí na `public.app_current_user_id()` (kanonický tvar od mig 285).

Sondy pod `tixly_app`, tři stavy GUC:

| tabulka | prázdný | po `RESET` | platné UUID |
|---|---|---|---|
| **RED** `catalog.scanner_devices` | 🔴 22P02 | 🔴 22P02 | ✅ OK |
| **RED** `identity.oauth_accounts` | 🔴 22P02 | 🔴 22P02 | ✅ OK |
| **RED** `lineups.artist_follows` | 🔴 22P02 | 🔴 22P02 | ✅ OK |
| **GREEN** všechny tři | ✅ OK | ✅ OK | ✅ OK |

🔴 **Podstatné je, že padá i po `RESET`** — ne jen po umělém `SET … = ''`.
`RESET` je přesně to, co dělá pool při vracení spojení, takže to není
laboratorní stav, ale běžný provoz. Fail-closed to nikdy nebylo.

⚠️ **Co 454 ZÁMĚRNĚ nedělá:** `oauth_accounts_own` a `artist_follows_own` čtou
v téže policy i `current_setting('app.is_service')` — name-drift jméno (§38).
Nahradit ho za `app_is_service()` by **aktivovalo dosud mrtvou větev**, tedy
rozšířilo přístup. To je jiné rozhodnutí než oprava pádu a patří do migrace
na 39 name-drift policies. 454 mění pouze tvar castu; množina viditelných
řádků se pro platné UUID nemění.

---

## §40 🔴 Migrace 453 NENÍ nasaditelná: 4 ze 7 tvarů JOINu ztratí data

126 JOIN sites na `identity.users` se dá roztřídit na **7 distinktních cest**.
`scripts/test-453-join-paths.mjs` seedne po jednom uživateli pro každý vztah
a změří viditelnost pod `tixly_app` v kontextu promotéra A.

| cesta | sites | před 453 | po 453 | verdikt |
|---|---|---|---|---|
| přes `orders` (`u.id=o.user_id`) | 63 | 1 | 1 | ✅ drží |
| přes `tickets` (`u.id=t.owner_id`) | 14 | 1 | **0** | 🔴 **ZTRACENO** |
| přes tým (`u.id=pm.user_id`) | 11 | 1 | 1 | ✅ drží |
| přímo podle `id` (guest bez objednávky) | — | 1 | **0** | 🔴 ZTRACENO |
| podle e-mailu (`LOWER(u.email)=`) | 8 | 1 | **0** | 🔴 ZTRACENO |
| actor/audit (`actor_user_id`…) | 9 | 1 | **0** | 🔴 ZTRACENO |
| anonymizovaný (měl objednávku) | — | 1 | 1 | ✅ drží |
| 🔒 cizí tenant | — | 1 | **0** | ✅ správně zmizel |

Izolace funguje (cizí tenant zmizel), ale **cena je vyšší, než §37 ukazovala** —
tam se testoval jen ten jeden tvar, který drží.

### 1. `tickets` → DÍRA V POLICY, ne správné chování

Nejzávažnější. Uživatel vlastní lístek na akci promotéra A, ale **objednávku
má někdo jiný** — dárek nebo lístek po transferu. Větev „zákazník přes orders"
ho nenajde, protože v `orders` není.

A není to okrajové: ty routes běží pod `runAsActivePromoter`, tedy přesně
v kontextu, kde policy zabírá:

```
admin/scanner/validate       runAsActivePromoter   ← kontrola na vstupu
admin/scanner/reentry        runAsActivePromoter
admin/scanner/validate-nfc   runAsActivePromoter
admin/commemorative/send     runAsActivePromoter
```

🔴 Po 453 by **skenování na vstupu přestalo vidět držitele lístku** u každého
dárku a každého transferu. Promotér na to má legitimní nárok — je to jeho akce.

**Návrh (NEAPLIKOVÁN — záměrně):** doplnit do 453 šestou větev
```sql
OR (app_current_promoter_id() IS NOT NULL AND EXISTS (
      SELECT 1 FROM tickets.tickets tk
      JOIN orders.orders o2 ON o2.id = tk.order_id
      JOIN catalog.events e2 ON e2.id = o2.event_id
      WHERE tk.owner_id = users.id AND e2.promoter_id = app_current_promoter_id()))
```
Nepřidávám ji naslepo: přidává třetí `EXISTS` na řádek a výkon 453 zatím
NENÍ změřený (§37). Patří to do jednoho rozhodnutí s `EXPLAIN` na datech.

### 2.–4. Zbylé tři: spíš správné chování než díra

- **actor/audit (9 sites)** — platformní pracovník bez vztahu k promotérovi.
  Že ho promotér nevidí, je **žádoucí**. Důsledek je kosmetický, ale reálný:
  v audit logu zůstane prázdné jméno místo „kdo to udělal". Produktové
  rozhodnutí, ne bezpečnostní.
- **přímo podle `id` / podle e-mailu** — testovaný případ byl guest, který
  checkout nedokončil, takže u promotéra objednávku nemá. Že ho promotér
  nevidí, je konzistentní se záměrem 453. Ale 5 z těch 8 e-mailových sites
  běží pod `runAsActivePromoter` (`admin/customers`, `customers/export`,
  `staff`, `team`, `broadcasts/send`) — a **jestli některý z nich cílí
  i na lidi bez objednávky (např. obnova opuštěného košíku), tiše se vyprázdní**.
  To NEJDE rozhodnout od stolu; vyžaduje projít těch 5 rout.

### Co tenhle test NEDOKAZUJE

Sonda je **jedna na cestu**, ne na všech 126 sites. Cesta „drží" znamená, že
drží ten tvar, který jsem seedoval — ne že všech 63 rout v kategorii `orders`
čte přes `orders`. Zbývá i **výkon** (stále neměřený) a 3 cesty, které mají
sites, ale nedostaly vlastní sondu (resale protistrany, `friend_id`,
feature tabulky typu waitlist/verified_fan).

---

## §41 453 na NAPLNĚNÉM klonu: šestá větev funguje, ale 453 nasadit NELZE

Data: **10 000 uživatelů, 50 000 objednávek, 100 000 lístků, 100 akcí,
50 promotérů** (každý 5. lístek je záměrně dárek — vlastník ≠ objednavatel).

### Cesty (promotérský kontext)

| cesta | BASE | 453 | 453+6 |
|---|---|---|---|
| orders (63 sites) | 5 | 5 | **5 ✅** |
| tickets (14 sites) | 2 | **0 🔴** | **2 ✅** |
| tým (11 sites) | 1 | 1 | **1 ✅** |
| přímo podle id | 1 | 0 | 0 |
| friend_id | 1 | 0 | 0 |
| waitlist / verified_fan | 1 | 0 | 0 |
| resale protistrana | 1 | 0 | 0 |
| 🔒 cizí tenant | 1 | **0 ✅** | **0 ✅** |

**Šestá větev dělá přesně to, co měla:** vrací cestu přes `tickets` a izolaci
nerozbíjí.

### Výkon — EXISTS větve jdou přes index, žádný seq scan

```
EXPLAIN (ANALYZE), 100 řádků:  BASE 0,5 ms → 453 2,3 ms (4,6×) → 453+6 4,3 ms (8,7×)
plný výpis zákazníků (200 distinct): 26,5 ms
uzly: 8× Index Scan (events), 2× Index Scan (orders), 1× Index Scan (tickets),
      1× Index Scan (users), Bitmap Heap/Index Scan (orders)
SEQ SCAN: jediný na promoter_members — a s loops=0, tedy NIKDY nevykonaný
```

🟢 **Žádný index chybět nemusí.** Násobek 8,7× zní hrozivě, ale absolutní čísla
jsou malá a všechny větve jsou index-backed. ⚠️ Měřeno na promotérovi s ~200
zákazníky; u promotéra se 100 000 zákazníky to poroste lineárně (cena je
per-row index lookup), ale **to jsem NEZMĚŘIL**.

### 🔴 VERDIKT: NE. Dva konkrétní blokátory, oba INNER JOIN

Poměr napříč 126 sites: **103 INNER JOIN vs 23 LEFT JOIN**. U LEFT JOINu řádek
přežije a jen se vyprázdní jméno (degradace). U INNER JOINu **řádek zmizí celý**.

**1. Sociální funkce v BUYER kontextu — tohle je horší než všechno ostatní.**
Všechna dosavadní měření běžela pod promotérem. Pod kupujícím má 453 jedinou
použitelnou větev — `id = app_current_user_id()`, tedy **vlastní řádek**.
Změřeno:

```
BUYER kontext (app.current_user_id, bez promotéra):
  vlastní řádek   : 1
  řádek kamaráda  : 0   → INNER JOIN vrátí 0 řádků → jméno ZMIZÍ
```

Dotčené (všechny INNER):
`api/social/friends`, `api/social/friend-requests` (2× — `from_user_id`,
`to_user_id`), `api/events/[id]/social-context` (`mf.friend_id`).
Po 453 by **seznam přátel obsahoval jen vás**.

**2. `admin/events/[id]/verified-fan`** — `JOIN identity.users u ON u.id = vfr.user_id`,
INNER. Registrovaný fanoušek, který u promotéra ještě nic nekoupil, z výpisu
vypadne. To je přitom celý smysl verified-fan: přihlášky PŘED prodejem.

### Co naopak blokátor NENÍ (doměřeno k §40)

**5 e-mailových rout pod `runAsActivePromoter`** — přečteno, verdikt per routa:

| routa | základ dotazu | cílí i na bezobjednávkové? | dopad 453 |
|---|---|---|---|
| `admin/customers` | `platform.promoter_contacts` **LEFT JOIN** users | **ANO** (importované kontakty) | degradace: `user_id` → NULL, řádek zůstane |
| `admin/customers/export` | tentýž tvar | **ANO** | degradace |
| `admin/broadcasts/[id]/send` | `promoter_contacts` + `newsletter_subscribers` **LEFT JOIN** | **ANO** | degradace; rozesílka jede z `pc.email`, ne z `u` |
| `admin/staff` | `promoter_members` **INNER JOIN** | NE | ✅ kryto větví „tým" |
| `admin/team` | `promoter_members` + `team_invites.invited_by_user_id` | NE | ✅ kryto, kromě zvatele, který už v týmu není |

Takže **2 ze 4 ztrát z §40 byly planý poplach**: `přímo podle id` i `podle
e-mailu` jsou v těchhle routách LEFT JOIN, takže řádek nezmizí, jen se
nedoplní. Skutečné blokátory jsou jinde — v sociálních funkcích a verified-fan.

### Návrh dalšího kroku (NEAPLIKOVÁN)

Sociální cesta potřebuje vlastní větev, ne rozšíření promotérské: „vidím
uživatele, se kterým mám potvrzené přátelství / čekající žádost".
To je jiný vztah než tenant scoping a měl by se řešit samostatně —
plošné rozšíření 453 by díru jen zvětšilo.

---

## §42 453 ROZDĚLENA podle vztahu — vše drží, izolace platí v OBOU kontextech

`identity.users` se čte ze dvou nezávislých důvodů. Migrace 453 to nově
vyjadřuje **třemi policies** místo jedné:

```
p_users_select_self      service │ platform admin │ vlastní řádek
p_users_select_promoter  app_can_see_user_as_promoter(id)
p_users_select_buyer     app_can_see_user_as_buyer(id)
```

**Proč tři policies, a ne jedna s OR:** Postgres permissive policies OR-uje
sám, takže výsledek je totožný — ale oddělené policies znemožňují
**strukturálně** to, co byl původní problém: aby rozšíření promotérské strany
zvětšilo přístup i v sociální. Navíc je `pg_policies` ukáže jako tři řádky,
takže je census i isolation harness měří odděleně. `identity.users` tenhle
vzor už používá (`p_users_write`, `p_users_promoter_insert`) — nezavádíme
nový styl. Predikáty jsou ve STABLE SQL helperech, aby šly testovat samostatně.

### Výsledek (klon z baseline, `tixly_app`)

| kontext | sonda | před | po |
|---|---|---|---|
| **promotér** | orders (63 sites) | 1 | **1 ✅** |
| | tickets (14 sites) | 1 | **1 ✅** |
| | tým (11 sites) | 1 | **1 ✅** |
| | verified-fan **bez objednávky** | 1 | **1 ✅** |
| | ⚪ bez vztahu | 1 | **0** správně zmizel |
| | 🔒 cizí tenant | 1 | **0 ✅** |
| **buyer** | vlastní řádek | 1 | **1 ✅** |
| | přítel (`friendships`) | 1 | **1 ✅** |
| | žádost příchozí (from→me) | 1 | **1 ✅** |
| | žádost odchozí (me→to) | 1 | **1 ✅** |
| | 🔒 cizí ne-přítel | 1 | **0 ✅** |
| | 🔒 cizí tenant | 1 | **0 ✅** |

**rozbitých cest: 0 | úniků: 0**

`verified_fan_requests` doplněn jako čtvrtá promotérská větev — fanoušek bez
objednávky je přesně smysl té funkce (přihlášky PŘED prodejem), takže to byla
chybějící větev, ne správné chování.

Buyer větev je ZÁMĚRNĚ jen přátelství + čekající žádost. Rozšíření na
„kdokoli na stejné akci" by z ní udělalo díru — na akci chodí tisíce lidí,
kteří o sobě nemají co vědět.

⚠️ Detail, který stojí za zapamatování: `social_graph.friendships` má
`CHECK (user_a < user_b)`, tedy kanonické pořadí dvojice. Helper proto **musí**
kontrolovat obě orientace. Můj první seed to porušil, dostal `23514`, a sonda
„přítel" pak měřila ne-přítele — vypadalo to jako rozbitá policy.

## §43 🕶️ Slepá dimenze: „měřeno pod promotérem" ≠ „měřeno"

Vedle slepých míst jednotlivých nástrojů (§36) je ještě jedno, které je
napříč všemi: **kontext, ve kterém se měří**.

Všech 58 sond isolation harnessu (§34) běželo pod promotérským kontextem
(`app.current_promoter_id` + `app.role='promoter'`). Buyer kontext se neměřil
ani jednou — a hned první měření (§41) našlo rozbité sociální funkce, které
by prošly do produkce.

**Rozsah, který to zaslepuje:**

```
policies celkem                                   598
user-scoped (buyer-relevantní)                    176
promoter-scoped                                   299
obojí                                              83
🔴 JEN user-scoped — buyer je JEDINÝ způsob, jak je vyhodnotit   93
```

🔴 **93 policies nelze pod promotérským kontextem vyhodnotit vůbec.** Sedí na
nich `identity.*` (mfa_configs, oauth_accounts, gdpr_requests, login_history,
notification_preferences…), `auth.passkey_*`, `compliance.*`, `blacklist.appeals`,
`catalog.waitlist_entries`, `catalog.lottery_entries`. Jsou to přesně ty
tabulky, kde se řeší soukromí uživatele — a o kterých naše měření neřeklo nic.

### Klíč k dopadu: INNER vs LEFT

Když policy řádek skryje, důsledek závisí na tvaru JOINu. Napříč 126 sites na
`identity.users`:

```
INNER JOIN : 103   → řádek ZMIZÍ CELÝ (funkce se tiše vyprázdní)
LEFT  JOIN :  23   → řádek zůstane, jen se nedoplní jméno (degradace)
```

Proto „RLS zabralo" nesmí být čteno jako „nic se nerozbilo": u 103 ze 126 míst
je rozdíl mezi skrytím a smazáním z pohledu UI nulový.

**Důsledek pro každé další měření:** každá sonda musí běžet v OBOU kontextech,
jinak měří jen polovinu. Skript `test-453-split.mjs` je tak psaný.

---

## §44 Migrace 455: name-drift jen u jmen IDENTITY — 20 policies, RED→GREEN

Migrace je **vygenerovaná z katalogu** (`scripts/gen-455-namedrift.mjs`),
ne psaná ručně: skript najde policies čtoucí `app.promoter_id` / `app.user_id`,
nahradí výraz kanonickým helperem a vypíše `DROP`/`CREATE POLICY` se zachovaným
`PERMISSIVE`/`RESTRICTIVE`, příkazem i rolemi. Nalezeno **20**, převedeno 20,
přeskočeno 0.

```
app.promoter_id → public.app_current_promoter_id()
app.user_id     → public.app_current_user_id()
```

### ⚠️ Proč jen 20 z 39

Zbylých 19 policies čte `app.bypass_rls`, `app.use_service_role`,
`app.is_service`, `app.is_admin`, `app.platform_admin`. **Nepřevádím ani jedno**
— a nejen `is_service`, jak znělo zadání. Všech pět je totiž táž kategorie:
**příznak zvýšení oprávnění, ne identita.** Dnes jsou mrtvé, protože je nikdo
nenastaví; napojit je na `app_is_service()` / `app_is_platform_admin()` by
**aktivovalo dosud mrtvou větev**, tedy rozšířilo přístup.

Dělicí čára je v ohraničení:
- jméno **identity** → vrací přístup k **vlastním** datům, omezeno tenantem
- příznak **oprávnění** → dává **plošný bypass**

Proto do 455 patří jen ta první skupina. Druhá potřebuje vlastní rozhodnutí
a vlastní měření.

### Vedlejší efekt: mizí past 22P02

Helpery dělají `NULLIF(current_setting(…), '')::uuid`, takže převod zároveň
odstraňuje přímé casty (§39) u všech 20 policies.

### RED→GREEN (klon z baseline, obě dimenze podle §43)

Cílem jsou tabulky, kde aplikace dnes **nevidí ani vlastní data**.
Každá obsahuje 2 řádky — vlastní a cizí:

| tabulka | kontext | před | po |
|---|---|---|---|
| `payments.wero_payments` | promotér | 0 | **1** ✅ |
| `catalog.event_sponsors` | promotér | 0 | **1** ✅ |
| `identity.magic_link_tokens` | buyer | 0 | **1** ✅ |

**opraveno 3, úniků 0** — vlastní řádek se zpřístupnil, cizí zůstal skrytý.

`wero_payments` je dobrá kontrola generátoru: `promoter_id` je tam **`text`,
ne `uuid`**, takže policy porovnávala textově — a generátor správně vyrobil
`(public.app_current_promoter_id())::text`, ne holý helper.

### Co NENÍ ověřeno

Sonda pokrývá **3 z 20** převedených policies (u zbylých by seed vyžadoval
delší FK/CHECK řetěz). Že se převod povedl textově u všech 20, je ověřené
(0 přeskočených, žádný starý GUC v SQL); že se **chování** změnilo správně
u všech 20, ověřené **není**.

---

## §45 🔴 VÝKON 453 NA OBJEMU: nasadit NELZE, a žádný index to nespraví

Objem: **100 000 uživatelů, 200 000 objednávek, 300 000 lístků, 400 akcí,
200 promotérů**, tým + verified-fan + 50 000 přátelství. Data rozprostřená
přes stovky promotérů, ne pod jedním — jinak by plánovač viděl jiné
statistiky než produkce.

### Malý promotér (500 zákazníků) — přijatelné

| dotaz | BASE | 453 | |
|---|---|---|---|
| orders JOIN (63 sites), LIMIT 100 | 0,9 ms | 19,2 ms | 22× |
| výpis zákazníků (stránka 200) | 9,9 ms | 129,7 ms | 13× |
| scanner přes tickets | 1,9 ms | 19,9 ms | 10× |
| buyer: seznam přátel | 0,4 ms | 5,8 ms | 14× |

Násobek je vysoký, absolutní čísla ještě snesitelná. `Seq Scan` se objevuje
jen na `catalog.events` (400 řádků, `loops=1`) a je tam **i v BASE** — není
způsobený policy.

### 🔴 Velký promotér (30 000 zákazníků) — blokátor

```
stránka 200 zákazníků : 18 643 ms
export všech          : 18 330 ms
```

**Stránkovaný výpis stojí stejně jako export všeho.** To je jádro problému:
`DISTINCT` + `ORDER BY` donutí vyhodnotit policy pro **všech 30 000** kandidátů,
teprve pak se uplatní `LIMIT 200`. Stránkování tu nešetří nic.

### Žádný index to nespraví — zkoušeno

| varianta | čas |
|---|---|
| bez nového indexu | 18 177 ms |
| `+ orders(user_id, event_id)` | **3 689 ms** |
| `+ events(id, promoter_id)` | 3 873 ms (beze změny) |
| denormalizace `orders.promoter_id` + `orders(user_id, promoter_id)` | **2 925 ms** |

Nejlepší varianta — přidat `promoter_id` přímo na `orders`, aby `EXISTS` byl
JEDNA sonda do indexu bez joinu — dá **2,9 s**. Pořád o dva řády víc, než
snese načtení stránky.

🔴 **Není to chybějící index, je to složitost O(kandidátů).** 2,9 s / 30 000
řádků ≈ 0,1 ms na řádek — to už JE rychlost indexu. Problém je, že se policy
vyhodnocuje 30 000×. RLS to z principu neumí obejít.

Izolace přitom drží: promotér vidí 30 000 ze 100 000 uživatelů, tedy přesně
své zákazníky.

### VERDIKT: 453 zpět POZASTAVENA

Nasaditelná je pro cesty, kde je kandidátů málo (buyer sociální dotazy,
scanner na jeden lístek, detail zákazníka). **Není** nasaditelná pro
administrátorské VÝPISY nad velkým promotérem.

**Návrh (NEAPLIKOVÁN):** výpisy zákazníků nemají na RLS stát. Dotaz si sám
scopuje promotéra (`WHERE e.promoter_id = $1`), takže RLS tam nefiltruje —
jen znovu ověřuje, co dotaz už udělal, a platí za to plnou cenou. Ty cesty
patří pod **service kontext**, kde je RLS pojistka, ne filtr. 453 pak zůstane
tam, kde skutečně chrání: buyer cesty a jednotlivé lookupy.
Rozhodnout se to musí vědomě — je to ústupek, ne úklid.

### Vedlejší nálezy

- **`audit_trigger_func` píše do `audit.audit_log` na každý INSERT.** Při
  hromadném seedu to vyčerpalo **strop Neon projektu 512 MB** (`53100`).
  Pro produkci to znamená, že objem auditu roste stejně rychle jako data.
- Neon projekt má **512 MB strop** — větší objemová měření vyžadují seed
  s vypnutými audit triggery (`DISABLE TRIGGER USER`).

---

## §46 Service-kontext návrh OBSTÁL; ale křivka VYVRACÍ moji příčinu z §45

### A) Předpoklad service-kontextu ověřen — 0 rout bere promotéra z parametru

61 admin/platform rout čte `identity.users`. Roztříděno podle autorizačního
obalu (ne podle textu dotazu — první pokus přes regex měl falešné negativy):

```
PROMOTER (runAsActivePromoter / runAsPromoter)   46
PLATFORM (runAsPlatformAdmin / …)                 1
bez rozpoznaného obalu                            5
```

🟢 **Ani jedna routa nebere promotéra z parametru requestu.** Grep na
`searchParams.get('promoter')`, `params.promoterId`, `body.promoter_id`
nevrátil nic. To byla nejhorší varianta (podvržení ID) a nenastala.

Pět rout bez obalu prověřeno ručně a všechny jsou v pořádku:
- `orders/route.ts`, `orders/export/route.ts` — `promoterId` se odvozuje
  z `getPromoterIdForUser(x-user-id)` a padá na 403 „Not a promoter member";
  pak `runWithPromoterContext(promoterId)`. Ze session, ne z parametru.
- `kyc/aml-check`, `payouts/execute` — explicitní kontrola `is_platform_admin`
- `2fa/setup` — `runAsUser`, self-service, není výpis

🔧 **Korekce dvou vlastních verdiktů z prvního skenu:** `resale-guarantee`
jsem označil za nescopující — je to `runAsPlatformAdmin`, tedy platformní
routa, která má vidět napříč tenanty **záměrně**. A `reports/pohoda` scopuje
přes `WHERE p.id = $1`, jen jiným tvarem, než hledal můj regex.

**Verdikt 1d: 46 z 46 promotérských rout scopuje, 0 bere promotéra
z parametru.** Předpoklad service-kontextového návrhu tedy platí.

### B) 🔧 KŘIVKA NESEDÍ S §45 — moje vysvětlení „O(kandidátů)" NEPLATÍ

Doměřeno 500 / 2 000 / 5 000 / 10 000 / 20 000 zákazníků, stránka 200 řádků:

```
zákazníků │ stránka 200 │ ms na zákazníka
      500 │       34 ms │ 0,067
    2 000 │       31 ms │ 0,015
    5 000 │       32 ms │ 0,006
   10 000 │       32 ms │ 0,003
   20 000 │       37 ms │ 0,002
```

🔴 **Křivka je PLOCHÁ.** Mezi 500 a 20 000 zákazníky se čas nezměnil.
To přímo odporuje závěru §45, kde jsem z bodů 500 → 130 ms a 30 000 → 18 643 ms
odvodil složitost O(kandidátů). **Ten závěr byl špatný** — počet zákazníků
sám o sobě cenu neurčuje.

Rozdíl konfigurací: §45 mělo 100 000 uživatelů, 200 000 objednávek a
**300 000 lístků**; křivka běžela nad 30 000 uživateli a **bez jediného lístku**
a bez verified-fan. Podezření tedy padá na větev přes `tickets` (případně
`verified_fan`), ne na počet zákazníků.

⚠️ **Ověřit se to nepodařilo.** Pokus doseedovat lístky do stejného klonu
skončil na `08P01 invalid message format` a kontext došel dřív, než jsem to
odladil. **Skutečný původce těch 18,6 s je tedy NEZNÁMÝ.**

Co z toho plyne prakticky: **453 zůstává pozastavená**, ale důvod je
„neobjasněný výkonový propad v konfiguraci s lístky", ne „O(kandidátů)".
Další krok je zopakovat §45 a přidávat jednu tabulku po druhé, dokud se
propad neobjeví.

## §47 ⚠️ Otevřené riziko: `audit.audit_log` roste bez retence

Zjištěno při seedu — nehledal jsem to.

- Trigger `audit_trigger_func()` visí na **`orders.orders`, `tickets.tickets`,
  `resale.resale_listings`** (`AFTER INSERT OR UPDATE OR DELETE`), tedy na
  třech nejobjemnějších tabulkách systému.
- Zapisuje **celé řádky, ne diff**: `to_jsonb(NEW)` při INSERT, `to_jsonb(OLD)`
  **i** `to_jsonb(NEW)` při UPDATE, `to_jsonb(OLD)` při DELETE. Jeden UPDATE
  objednávky tedy uloží dvě kompletní kopie řádku.
- **Žádná retence, archivace ani partitioning nenalezeny** — v migracích ani
  v `api/cron/`. Grep na `DELETE FROM audit.audit_log` nevrací nic.

Doloženo v praxi: hromadný seed 200 000 objednávek + 300 000 lístků vyčerpal
strop Neon projektu **512 MB** (`53100 could not extend file because project
size limit has been exceeded`) — a to výhradně kvůli auditním řádkům; s
`DISABLE TRIGGER USER` prošel tentýž seed bez potíží.

🔴 Objem auditu roste **rychleji než data samotná** (UPDATE = 2× řádek).
Bez retence to na produkci narazí na strop taky, jen později. **NEOPRAVENO.**

---

## §48 🎯 PROPAD IZOLOVÁN: vnořené RLS, ne lístky a ne počet zákazníků

Přírůstkový seed, po každém kroku tentýž dotaz (výpis 200 zákazníků,
velký promotér s 30 000 zákazníky, vše pod 453):

```
1. users + objednávky velkého promotéra      361 ms
2. + rozprostřené objednávky (230k celkem)  46 279 ms   ← 128× SKOK
3. + lístky (300k)                          49 795 ms   (1,1×)
4. + verified-fan                           48 645 ms   (1,0×)
5. + přátelství (50k)                       47 851 ms   (1,0×)
```

🔴 **Viníkem je krok 2 — objem `orders.orders`. Lístky s tím nemají nic
společného** (1,1×), stejně jako verified-fan a přátelství. Moje podezření
z §46 bylo mimo.

### Mechanismus: policy uvnitř policy

`EXPLAIN` po kroku 3 ukazuje jádro věci:

```
Index Scan users loops=31000 rows=1 shared_hit=467142
   filter=(COALESCE(NULLIF(current_setting('app.role'…
Bitmap Heap Scan orders loops=2 rows=15500
   filter=(COALESCE(NULLIF(current_setting('app.is_platform_admin'…
```

`orders.orders` má **vlastní RLS policy**. Vnitřní `EXISTS` v
`app_can_see_user_as_promoter()` na ni sahá, takže se pro **každého** z 31 000
kandidátů na `users` vyhodnotí ještě policy nad `orders`. To jsou **vnořené
RLS** — a jejich cena roste s objemem CIZÍ tabulky, ne s počtem zákazníků.

Tím se vysvětluje i to, proč byla křivka v §46 plochá: tam měla `orders` jen
objednávky velkého promotéra. Nešlo o počet kandidátů, ale o to, přes kolik
řádků musí projít vnořená policy.

### Oprava: `SECURITY DEFINER` — 20×

```
INVOKER (dnešní 453)                       54 675 ms
SECURITY DEFINER                            2 753 ms   ← 20×
+ orders(user_id,event_id)                  2 812 ms   (indexy už nepřidají nic)
+ tickets(owner_id,order_id), vfr(…)        2 859 ms
```

Funkce si tenanta omezuje **sama** (`promoter_id = app_current_promoter_id()`),
takže obejití RLS nad `orders` nic nezpřístupní navíc. Ověřeno měřením:
promotér vidí **35 303 ze 100 000** uživatelů = 30 350 vlastních zákazníků
+ držitelé lístků (dárky) + tým + verified-fan. Izolace drží.

Do migrace doplněn i `SET search_path = pg_catalog, public` — u
`SECURITY DEFINER` je to povinnost, jinak lze funkci podstrčit vlastní schéma.

**Indexy nepřidaly nic.** Po odstranění vnořených RLS je zbytek už optimální.

### Zbytkových 2,8 s je JINÁ věc — a týká se jediného tvaru dotazu

Po opravě pod stejnými daty:

```
scanner přes tickets            62 ms  🟢
orders JOIN, LIMIT 100          57 ms  🟢
výpis DISTINCT + ORDER BY 200  2 812 ms  🔴
```

Běžné cesty jsou v pořádku. Drahý zůstal **jen** tvar
`SELECT DISTINCT … ORDER BY u.id LIMIT 200`: `DISTINCT` a `ORDER BY` musí
vyhodnotit policy pro všech 30 000 kandidátů, teprve pak se uplatní `LIMIT`.
**Tady** O(kandidátů) skutečně platí — ale jen pro tenhle jeden tvar, ne
plošně, jak jsem tvrdil v §45.

### 🔧 Rekapitulace mých vlastních chyb v této linii

| kde | tvrzení | co se ukázalo |
|---|---|---|
| §45 | „O(kandidátů), index nepomůže" | plošně **špatně** — 128× skok dělala vnořená RLS |
| §46 | „podezření padá na větev přes `tickets`" | **špatně** — lístky přidaly 1,1 % |
| §48 | vnořené RLS nad `orders` | **potvrzeno** plánem i opravou (20×) |

Platí jen zúžená verze: O(kandidátů) je reálné pro `DISTINCT`+`ORDER BY` výpis.

## §49 VERDIKT 453: nasaditelná pro provozní cesty, výpis potřebuje rozhodnutí

🟢 **Nasaditelná** — se `SECURITY DEFINER` helpery. Scanner 62 ms,
`orders` JOIN 57 ms, správnost i izolace ověřené (§42, §48).

🟡 **Jedna výhrada:** výpis zákazníků velkého promotéra (30k, `DISTINCT` +
`ORDER BY` + stránka 200) stojí **2,8 s**. Není to blokátor nasazení policy,
je to vlastnost jednoho tvaru dotazu. Možnosti (NEROZHODNUTO):
- stránkovat keyset místo `DISTINCT`+`OFFSET`
- výpis číst pod service kontextem (dotaz si promotéra scopuje sám — ověřeno
  v §46, 46/46 rout scopuje a 0 bere promotéra z parametru)
- nebo 2,8 s u největších promotérů akceptovat

`SECURITY DEFINER` je v migraci 453 **aplikován**. Přeměřeno.

---

## §50 Vnořené RLS: 173 z 596 policies — ale drahé je jen 54 z nich

453 **nebyla výjimka, je to vzor.** `scripts/rls-nested-scan.mjs` prošel katalog:

```
policies celkem                    596
tabulek se zapnutým RLS            411
🔴 policies s vnořeným RLS         173   (29 %)
   zdrojových tabulek              167
```

Cílové tabulky (na kolik policies vnořeně sahá):

```
153×  catalog.events              (malá)
 54×  orders.orders               ⚠️ VELKOOBJEMOVÁ
  7×  platform.promoter_members
  2×  platform.promoters, catalog.venues, conference.exhibitors
  1×  identity.users, marketing.loyalty_accounts, platform.payouts, …
```

### 🎯 Cena vnořeného RLS závisí na VELIKOSTI CÍLOVÉ tabulky, ne na počtu policies

Změřeno na klonu se 100 000 uživateli a **230 000 objednávkami**, tentýž dotaz
s RLS na cílové tabulce zapnutým a vypnutým:

| vzorec | s RLS | bez RLS | násobek |
|---|---|---|---|
| `orders.orders` → `catalog.events` | 27 ms | 26 ms | **1,1×** |
| `tickets.tickets` → `catalog.events` | 1 ms | 1 ms | **1,2×** |
| `identity.users` → `orders.orders` (§48) | 46 279 ms | 361 ms | **128×** |

🟢 **Vnoření nad `catalog.events` je prakticky zdarma** — `events` je malá
(stovky až tisíce řádků), takže vnořená policy proběhne bez měřitelného dopadu.
Těch 153 policies tedy **není problém**.

🔴 **Drahé je vnoření nad `orders.orders`** — 230k řádků, a právě to dělalo
těch 128× u `identity.users`.

### VERDIKT ČÍSLEM

```
173 policies má vnořené RLS
 54 z nich míří na orders.orders  ← jediná rizikováskupina
100 míří výhradně na catalog.events (změřeno 1,1× = zanedbatelné)
```

**Rizikových je 54, ne 173.** A z nich je jedna (`identity.users`) už opravená
`SECURITY DEFINER`. Zbývá **53 policies** nad velkou tabulkou, u kterých se
násobič projeví teprve až `orders` naroste.

⚠️ Násobek 128× byl naměřen na dotazu, který vyhodnocoval policy pro 31 000
kandidátů. U policies s málo kandidáty bude dopad menší — konkrétní číslo pro
těch 53 **NEZMĚŘENO**, měřeny byly tři reprezentanty.

### 🔧 Chyba v mém vlastním scanneru — „0 nepřímých" NEPLATÍ

Skript hlásí „z toho přes funkci: 0" a „policies volající SECURITY DEFINER: 0".
Self-check to vyvrátil: po aplikaci 453 (kde `p_users_select_promoter` volá
`app_can_see_user_as_promoter()`) hlásil pořád nuly.

Příčina: oba čítače počítám nad polem `findings`, do kterého se policy dostane
jen tehdy, když má aspoň jeden **přímý** zásah na RLS tabulku. Policy, která
sahá na tabulky *výhradně přes funkci*, se do `findings` nedostane vůbec,
takže ji čítač strukturálně nemůže vidět.

🔴 **Číslo 173 je proto DOLNÍ ODHAD.** Policies, které se k RLS tabulce
dostávají jen přes volanou funkci, v něm nejsou. Kolik jich je, **NEVÍM** —
oprava scanneru je první krok příště.

## §51 Pravidlo pro `SECURITY DEFINER` v RLS policies

`SECURITY DEFINER` je jediný způsob, jak vnořené RLS odstranit (indexy nepomohly,
§48). Zároveň je to obcházení RLS, takže potřebuje pravidlo.

### Ověřeno měřením, ne úvahou

Test: uživatel, který nakoupil **výhradně** u promotéra B; dívá se promotér A.

```
zákazník POUZE promotéra B : viditelný=0   app_can_see_user_as_promoter()=false   ✅
vlastní zákazník           : viditelný=1                                          ✅
uživatelů, kde funkce=true BEZ objednávky u A: 0
```

`SECURITY DEFINER` v 453 tedy **neuniká** — obchází RLS nad `orders`, ale
výsledek zůstává omezený tenantem.

### Kdy je bezpečné

1. **Funkce si scopuje tenanta SAMA** z GUC (`app_current_promoter_id()`,
   `app_current_user_id()`), ne z parametru od volajícího. Parametr smí být
   jen *cíl* dotazu (`target`), nikdy *identita*.
2. **`SET search_path = pg_catalog, public`** — jinak lze funkci podstrčit
   vlastní schéma se stejně pojmenovanými tabulkami.
3. **Funkce vrací `boolean`, ne data.** Nesmí být kanálem, kterým by se dal
   z cizí tabulky vytáhnout obsah.
4. **Tělo neobsahuje nic dynamického** (`EXECUTE`, konkatenace SQL).

### Kdy NE

- identita přichází parametrem → volající si ji zvolí sám
- funkce vrací řádky/sloupce z chráněné tabulky
- scoping závisí na tabulce, kterou právě obchází (kruhová logika)
- bez `search_path`

Všechny čtyři podmínky ověřuj **měřením** (cizí tenant → `false`), ne čtením.

---

## §52 Scanner opraven a DOLOŽEN; čísla 173/54 se nezměnila

Předchozí verze počítala „přes funkci" a „SECURITY DEFINER" nad polem
`findings`, kam se policy dostala jen při **přímém** zásahu — policy sahající
na RLS tabulku výhradně přes funkci tam nikdy nedorazila. Oprava: `reach()`
vstupuje i do `SECURITY DEFINER` funkcí a jejich zásahy jen **označí**
`mitigated` místo aby je zahodila.

### Self-check v obou směrech (povinný, ne volitelný)

| stav | vnořené RLS | přes funkci | ošetřeno SECDEF | `p_users_select_promoter` |
|---|---|---|---|---|
| baseline (bez 453) | 173 | 0 | 0 | — |
| + 453 (`SECURITY DEFINER`) | 173 **(+1 plně ošetřená)** | **1** | **1** | nalezena, živé cíle `[]` |
| + 453 přepnuto na `INVOKER` | **174** | **1** | 0 | nalezena, živé: `orders.orders (přes app_can_see_user_as_promoter())` + 4 další |

Scanner tedy prokazatelně **umí** najít nález té třídy a umí ho i správně
odlišit podle `SECURITY DEFINER`. Teprve teď má „0 přes funkci" v baseline
váhu — je to doložená nula, ne nezměřená.

🔧 **Čísla se nezměnila: pořád 173 s vnořeným RLS, 54 nad `orders.orders`.**
V baseline schématu žádná policy nesahá na RLS tabulku přes funkci. Dolní odhad
z §50 byl tedy náhodou správný — ale nebyl podložený.

## §53 Dopad zbývajících: 128× byla VÝJIMKA, ne běžná hodnota

| vzorec | zdroj (řádků) | cíl (řádků) | s RLS | bez | násobek |
|---|---|---|---|---|---|
| `identity.users` → `orders.orders` | 100k kandidátů | 230k | 46 279 ms | 361 ms | **128×** |
| `orders.order_items` → `orders.orders` | 200k | 200k | 224 ms | 166 ms | **1,4×** |
| `orders.orders` → `catalog.events` | 230k | 400 | 27 ms | 26 ms | **1,1×** |
| `tickets.tickets` → `catalog.events` | 300k | 400 | 1 ms | 1 ms | **1,2×** |

🎯 **Rozhodující není vnoření samo, ale TVAR predikátu.**
`order_items` má 200 000 kandidátů a cílí na stejně velkou `orders` — a stojí
1,4×. `identity.users` stálo 128×, protože jeho policy je `EXISTS` s **joinem**
(`orders` → `events`) vyhodnocovaný pro každého kandidáta zvlášť, navíc
v dotazu s `DISTINCT`+`ORDER BY`, který si vynutil všech 31 000 vyhodnocení.
Vnořené RLS je zesilovač, ne příčina.

### VERDIKT 2c

```
změřeno reprezentantů : 4  (z toho 1 z rizikové skupiny 54)
> 5× (reálný problém) : 1  — identity.users, UŽ OPRAVENÁ
< 2× (šum)            : 3
nezměřeno             : 50 z 53 zbývajících
```

**Z toho, co je změřené, je 128× výjimka.** Netvrdím, že zbylých 50 je
v pořádku — jen že vzorek nepodporuje domněnku plošného problému. Napovědou pro
prioritizaci je tvar: policy s `EXISTS` obsahujícím **join** nad velkou tabulkou
je podezřelá, prostý `IN (SELECT …)` nad indexem není.

## §54 Metodické pravidlo: nula z nástroje není nález, dokud není doložená

**„Nula z nástroje neznamená nic, dokud není doloženo, že nástroj nálezy té
třídy umí najít."**

Není to obecná opatrnost — je to zkušenost z tohohle projektu. Pokaždé šlo
o nulu nebo zelenou, která vypadala jako výsledek, a byla to jen slepota:

| nástroj / měření | hlásilo | čím byl slepý | jak se to provalilo |
|---|---|---|---|
| `schema-drift-guard` | 0, „pokrytí 94,7 %" | parse-only: nevidí `NOT NULL`, `ON CONFLICT`, `CHECK` | 9 z 11 rizikových INSERTů neslo skrytý blocker |
| `schema-reality-scan` | 0 v dané třídě | dynamické SQL (135 dotazů), `42P08`, defaulty | `base64url` (§35) nenašel žádný nástroj |
| sken pod ownerem | „vše prošlo" | `BYPASSRLS` — celá vrstva oprávnění | pod `tixly_app` +6 nálezů (§33) |
| live sada | 30/30 zelených | jen 30 cest; RLS mimo dohled | pod `tixly_app` 6 pádů (§31) |
| výkon 453 | 2 body křivky | mezi body se neměřilo | §45 „O(kandidátů)" vyvráceno §46 |
| pokrytí 453 | 1 tvar JOINu | dalších 6 tvarů | §37 „vše drží" vyvráceno §40 |
| RLS izolace | 58 vzorců | jen promotérský kontext | buyer našel rozbité sociální funkce (§43) |
| `rls-nested-scan` | „přes funkci: 0" | čítač nad `findings`, kam nepřímé nedorazí | self-check §52 |

### Jak se slepota testuje: self-check s vloženým známým nálezem

Ke každému nástroji patří test, který mu **podstrčí nález té třídy, kterou má
hledat**, a ověří, že ho najde. Bez toho je nula jen mlčení.

| nástroj | self-check |
|---|---|
| `rls-nested-scan` | přepnout helper na `INVOKER` → musí přibýt živý nález (§52) |
| `schema-reality-scan` | pustit pod `tixly_app` i pod ownerem → rozdíl je míra slepoty (§33) |
| live sada | `LIVE_AS_APP_ROLE=1` → musí spadnout, co pod ownerem prošlo (§31) |
| izolace RLS | seedovat CIZÍ řádek → musí zmizet; a VLASTNÍ → musí zůstat (§42) |
| výkonové měření | aspoň 3 body křivky, ne 2; a měnit jednu proměnnou (§48) |
| `gen-baseline-globals` | pojistka na podkročení počtů (chytila mou chybu v regexu) |

Pravidlo do budoucna: **než zapíšu „0 nálezů", musím být schopen ukázat běh,
ve kterém týž nástroj nad upraveným vstupem vrátí ≥ 1.**
