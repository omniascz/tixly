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
