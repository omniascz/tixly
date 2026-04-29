# Open-source ticketing — benchmark Hi.Events & pretix

> Datum: 2026-04-29
> Účel: Posoudit využitelnost open-source platforem Hi.Events a pretix pro Tixly.
> Závěr nahoře: **ani jedna nesedí jako foundation**, obě stojí za benchmark v konkrétních úzkých oblastech.

---

## 1. Executive summary

| | Hi.Events | pretix | Tixly |
|---|---|---|---|
| Stack | PHP/Laravel + React/Vite (Mantine, Lingui, React Query) | Python/Django + HTML/Vue/JS | Node/Next.js + Kafka microservices |
| DB | Postgres/MySQL (Laravel) | **Postgres povinné v produkci** + Redis | Postgres + Redis |
| Licence | AGPL-3.0 + komerční | AGPL-3.0 + dodatky | proprietární |
| ★ / zralost | 3,7k ★, v1.9.0-beta (28.4.2026) | 2,4k ★, **stable**, miliony prodaných vstupenek | — |
| Seat maps | ❌ není | ✅ **Graphical plan editor** (seats.pretix.eu) | ✅ SVG editor + Redis SETNX 7 min lock |
| Multi-tenant | ❌ single-organizer | ✅ multi-organizer | ✅ RLS multi-tenant |
| Resale + price cap | ❌ | ❌ | ✅ |
| TOTP rotující QR | ❌ statický QR | ❌ statický QR | ✅ HMAC-SHA256, 30s rotace |
| Anti-scalping | ❌ | ❌ | ✅ 4-vrstvý + BankID/Onfido |
| Plugin systém | ❌ | ✅ **Plugin marketplace** | částečně (vertikály) |
| Offline check-in | ✅ | ✅ **pretixSCAN** + pretixPOS + pretixKIOSK | ✅ Gate Service |
| GDPR / WCAG | nezmíněno | ✅ ISO 27001, WCAG, EN 301 549, made in DE | ✅ event-driven výmaz |
| CZ platby (GoPay/ComGate/Wero) | ❌ jen Stripe Connect | ❌ Stripe/PayPal/Mollie/Adyen + SEPA, **GoPay nepokrýva** | ✅ GoPay primary |
| API + webhooks | REST API, webhooks (Zapier/Make) | REST API + webhooks + **OAuth + Device auth** + idempotency + rate limiting | REST + GraphQL BFF |

**Verdikt:**
- **Hi.Events:** mladší, jednodušší, primárně pro malé pořadatele. Užitečný benchmark pro UX onboardingu.
- **pretix:** zralá enterprise platforma s tím nejbližším feature setem k Tixly. Užitečný benchmark pro plugin architekturu, API design, accessibility, seating editor UX.
- **Foundation pro Tixly:** ani jedna. Stack mismatch (PHP/Python vs. Node), licence (AGPL by nutila open-sourcovat Tixly nebo platit komerční licenci), a hlavně **chybí všechny tixly differentiátory** (resale s price-capem, TOTP rotace, anti-scalping, CZ platby).

---

## 2. Hi.Events — detailní benchmark

### 2.1 Architektura
- **Backend:** Laravel s explicitní DDD vrstvou: `Action → Handler → DomainService → Repository`
- **DTOs:** Spatie Laravel Data, base třída `BaseDataObject`
- **Frontend:** React + Vite, **SSR** (server-side rendering), Mantine UI, React Query, Lingui i18n, SCSS modules
- **ID strategie:** auto-incrementing integer (ne UUID) — opačná volba než Tixly
- **Sanitizace:** centrální HtmlPurifierService

### 2.2 Co Hi.Events umí
- ticket types: free / paid / donation / **tiered** (fázové ceníky)
- promo kódy + pre-sale access
- product addons + custom checkout questions
- QR check-in se scan logem (statický QR, ne TOTP)
- realtime sales dashboard, advanced reporting
- webhooks (Zapier, Make, CRMs)
- REST API
- multi-language UI
- branded checkout + organizer homepage
- offline check-in
- Stripe Connect instant payouts + offline platby

### 2.3 Co Hi.Events **neumí** (proti Tixly)
- seat maps / SVG floor plan / reserved seating
- multi-tenant (jeden organizer per instanci)
- resale marketplace s price-capem
- TOTP rotující QR
- anti-scalping (rate limit, ticket binding, gate validation, monitoring)
- season passes / recurring members
- dynamic pricing (demand-based)
- identity verification (BankID/Onfido)
- recurring events / parent-child eventy
- GoPay / ComGate / Wero / Przelewy24 (jen Stripe Connect)
- explicitní GDPR výmaz tooling
- plugin systém třetích stran

### 2.4 Co stojí za inspiraci
1. **DDD struktura** `Action/Handler/DomainService/Repository` — čistá vrstva pro orchestraci request → use case → data access. Použitelný vzor pro tixly Order Service a Event Service, i když v Node.
2. **Spatie Laravel Data DTO pattern** — analogie: zod schémata na hranicích služeb. Princip: **DTO jako single source of truth pro tvar dat napříč API a doménou**.
3. **Composition over inheritance** + custom exceptions — kompatibilní s tím, co tixly už dělá.
4. **DatabaseTransactions v testech** (ne RefreshDatabase) — rychlejší integrační testy, vzor pro tixly testovací strategii.
5. **HtmlPurifier centrální service** — kandidát na rozšíření tixly `input-validation`.

### 2.5 Co stojí za benchmark UX
- **Organizer onboarding flow** — kolik kroků od registrace k publish prvního eventu. Stáhnout, naklikat, zaznamenat počet kroků a porovnat s tixly `promoter-onboarding`.
- **Custom checkout questions UI** — drag&drop, conditional logic, required vs. optional. Porovnat s tixly `checkout-questions`.
- **Branded organizer homepage** — koncept veřejné stránky pořadatele jako "mini-eventbrite" subdoména.
- **Embed widget** — pokud existuje, podívat se jak je řešený (iframe vs. JS SDK).

### 2.6 Licenční riziko
**AGPL-3.0** = jakékoli použití kódu Hi.Events v Tixly (i jako library) by znamenalo nutnost open-sourcovat celé Tixly. Komerční licence existuje, ale za poplatek.
**Doporučení:** ani neforkovat repo do interních systémů. Jen běžně procházet na GitHubu jako referenci.

---

## 3. pretix — detailní benchmark

### 3.1 Architektura
- **Backend:** Python/Django (78 % codebase), monolitická aplikace s plugin systémem
- **Frontend:** HTML + Vue/JS (5 %) + SCSS — **server-rendered, ne SPA**
- **Infrastruktura:**
  - WSGI app server (gunicorn)
  - **Postgres povinné v produkci** (SQLite jen dev/eval)
  - **Redis** povinný (cache, sessions, task queue)
  - cron pro periodické tasky
  - nginx/Apache reverse proxy + SSL
  - volitelně RabbitMQ / memcached
- **API auth:** Token + OAuth + Device authentication s security profily
- **Idempotency:** vestavěná (klíčový rozdíl proti Hi.Events)

### 3.2 Co pretix umí (kompletní inventář)

#### Core ticketing
- customizovatelný ticket shop
- individuální vstupenky (různé ticket types)
- waiting list (automatický)
- check-in & box office
- reports & statistiky
- marketing toolkit
- ticket vouchers, gift cards
- customers + memberships (season pass ekvivalent)
- invoices
- subevents (varianty parent-child eventů)

#### Seat maps ✅
- **Graphical plan editor** dostupný na `seats.pretix.eu`
- "Ticket buyers can choose their own seats on an interactive seating plan"
- Používá vlastní formát (ne SVG fork)

#### Compliance ✅
- **GDPR compliant**, made in Germany
- **ISO 27001 certified**
- **WCAG + EN 301 549** accessible ticket shop
- hostováno s renewable power

#### Multi-organizer ✅
- multi-tenant architektura (organizers → events → subevents)
- white-label + custom domain
- **publish ticket shop in multiple languages at the same time** (DE/NL/EN nativně, plugin marketplace pro další)

#### Plugin marketplace ✅
- klíčový rozdíl: **plugin extensibility z první ruky**
- pretix-plugins lze přidávat platby, integrace, business logiku

#### Ekosystém produktů
- **pretixSCAN** — mobilní app pro offline check-in s live badge printing
- **pretixPOS** — pokladní aplikace
- **pretixKIOSK** — vending machine app
- **pretixLEAD** — exhibitor networking
- **Venueless** — digital event platform
- hardware k pronájmu

#### REST API (od v1.5)
- resources: organizers, events, items, orders, invoices, customers, memberships, gift cards
- 3 typy auth: Token / OAuth / Device
- **idempotency**, **rate limiting**, conditional fetching, pagination, file upload
- webhooks s těmito event types:
  - `pretix.event.order.placed`, `.paid`, `.canceled`, `.modified`
  - `pretix.event.order.payment.confirmed`, `.refund.created`
  - `pretix.event.checkin`, `.checkin.reverted`
  - `pretix.giftcards.created`, `.modified`
  - `pretix.customer.created`, `.changed`
  - plugins mohou registrovat další

#### Platební providery
- **Stripe** (Affirm, Alipay, Apple Pay, Bancontact, Credit card, eps, Google Pay, iDEAL, Klarna, Multibanco, Przelewy24, SEPA DD, Swish, TWINT, WeChat Pay)
- **PayPal** (+ Bancontact, Blik, eps, iDEAL, Multibanco, MyBank, Przelewy24, Trustly)
- **Mollie** (Apple Pay, BANCOMAT, Bancontact, Bitcoin, Blik, CC, eps, iDEAL, Klarna, PayPal, Przelewy24, SEPA, Trustly, TWINT)
- **Adyen**
- SEPA DD, SEPA transfer, GoCardless
- bank wire transfer (manuální i automatický statement upload)
- automatická generace faktur

### 3.3 Co pretix **neumí** (proti Tixly)
- **GoPay / ComGate / Wero / Twisto / Przelewy24 (kromě přes Stripe/Mollie)** — žádný native CZ provider
- resale marketplace s price-capem (uživatel může vstupenku nanejvýš převést)
- anti-scalping vrstvy (rate limit + binding + gate + monitoring)
- TOTP rotující QR (statický QR ze stringu)
- dynamic pricing (demand-based, jen tier/voucher)
- identity verification přes BankID/Onfido
- "Right to Access" generický model pro 40 vertikál (pretix je čistě eventy)
- integrace s českými systémy (datové schránky, ARES/RES, pojišťovny)

### 3.4 Co stojí za inspiraci od pretix

#### A. **Plugin marketplace architektura** — nejcennější
Pretix má 10+ let zralou plugin extensibility. Pro tixly s 40 vertikálami je tohle **přesně to, co architektura potřebuje**: místo aby byl každý vertikální feature zakódován v core, je modul s definovaným kontraktem (entity points, hooks, settings).

**Akce:** prostudovat `pretix/base/plugins.py` mechanismus a `signal/receiver` vzor jako referenci, pak navrhnout ekvivalent pro tixly v Node (např. workspace package per vertikála s event subscribery na Kafka).

#### B. **REST API kontrakt** — best practice referenční model
3 auth metody (Token / OAuth / Device), idempotency, rate limiting, OAuth grants — to je **enterprise-grade API design**, který tixly `b2b-api` může napodobit jako kontrakt.

**Akce:** stáhnout pretix OpenAPI spec (pokud existuje) nebo pretix-py SDK a porovnat s tixly `b2b-api/openapi.yaml`.

#### C. **Webhook event taxonomie**
Pretix má jasnou hierarchii: `pretix.{scope}.{resource}.{action}`. Tixly může adoptovat podobnou konvenci pro `webhooks/`:
```
tixly.event.order.placed
tixly.event.order.paid
tixly.event.checkin.confirmed
tixly.resale.listing.created
```

#### D. **Subevents pattern**
Pretix subevents = parent event + child instance. Tixly to řeší přes `parent_event_id` a iCal RRULE — pretix je referenční implementací této logiky pro recurring events (lekce, ordinace, golf rezervace).

#### E. **Seating editor UX**
`seats.pretix.eu` je standalone graphical editor pro plány. Tixly seat-map editor (`seat-map/`) má jiný formát (SVG fork), ale UX flow stojí za prozkoumání:
- jak řeší zóny vs. řady vs. sedadla
- jak handle accessibility seats
- jak řeší blocked seats / kill seats
- jak řeší capacity per seat (1 vs. N osob)

#### F. **Accessibility (WCAG + EN 301 549)**
Tixly `wcag-compliance/` modul může profitovat z toho, jak pretix řeší accessibility v ticket shopu (screen reader flow, keyboard nav, contrast). EN 301 549 je EU standard pro veřejný sektor — relevantní pro tixly Fáze 9 (úřady, magistráty).

#### G. **Idempotency keys v API**
Pretix má idempotency vestavěnou v REST API. Tixly to potřebuje pro:
- order creation (anti-double-charge)
- webhook delivery
- B2B partnerské integrace

#### H. **Device authentication**
Pretix Device auth = vyhrazený auth profile pro pretixSCAN tablety/scannery. Tixly Gate Service může adoptovat: scanner = entity s vlastním device fingerprint a auth tokenem (ne user JWT).

### 3.5 Licenční riziko
**AGPL-3.0 + dodatky.** Stejná jako Hi.Events — fork nebo library use by nutila open-sourcovat tixly. **Doporučení:** používat pretix jen jako **reference implementation** přes:
- veřejnou docs.pretix.eu
- veřejný GitHub kód jako čtenou referenci (ne kopírovat)
- hraní si s instancí v Dockeru pro UX poznámky

### 3.6 Komerční implikace
Pretix nabízí **pretix Enterprise + hosted SaaS** — to je přímý konkurent tixly v EU, hlavně pro DACH region. Je důležité si uvědomit:
- pretix má enterprise zákazníky (FOSDEM, Republica, Chaos Computer Club a další konference)
- nemá silnou pozici v CZ/SK kvůli chybějícím lokálním platbám
- nemá resale marketplace ani anti-scalping → není konkurent na koncerty s reseller riskem
- silný v: konference, expo, tech eventy, kulturní organizace v DACH

**Tixly je vůči pretix komplementární na vyšším bezpečnostním stupni** (resale + scalping = koncertní/festival market) **a CZ/SK lokalizací**.

---

## 4. Doporučená akce pro tixly

### Co rovnou neudělat
- ❌ Forknout ani jeden repo
- ❌ Kopírovat jakýkoli kód (AGPL trap)
- ❌ Přebrat databázové schéma 1:1
- ❌ Migrovat tixly z Node na PHP/Python

### Co udělat (~1–2 dny průzkumu)
1. **Stáhnout pretix lokálně** (`docker compose up`), naklikat:
   - vytvoření organizeru → eventu → subevents → ticket types → seating plan → publish
   - jako návštěvník: přes shop koupit, zaplatit, dostat vstupenku, refund
   - **počet kroků a čas zaznamenat** do `analysis/onboarding-benchmarks.md`
2. **Stáhnout Hi.Events** stejným postupem — kratší flow, jiná persona (malý pořadatel)
3. **Stáhnout OpenAPI specy obou** a porovnat s tixly `b2b-api/openapi.yaml`:
   - které endpointy obě mají a tixly nemá → kandidáti na rozšíření
   - které tixly má a oba nemají → tixly diferenciátory (resale, anti-scalping, TOTP, SCV)
4. **Prozkoumat pretix plugin mechanismus** (`pretix/base/plugins.py`, signals, receivers) jako referenci pro tixly vertical-as-plugin architekturu
5. **Webhook event taxonomie** — adoptovat `tixly.{scope}.{resource}.{action}` konvenci napříč `webhooks/`

### Output průzkumu
Jeden markdown v `analysis/`:
- `onboarding-benchmarks.md` — UX kroky obou + tixly screenshoty
- update tohoto dokumentu o screenshoty a poznámky z hands-on
- `architecture.md` doplnění o "plugin extensibility model" jako roadmap položku

---

## 5. Pozičování tixly vůči těmto platformám (one-liner)

| Platforma | Tixly se proti ní pozicionuje jako… |
|---|---|
| **Hi.Events** | Enterprise s seat-mapou, resale, anti-scalpingem a CZ platbami; tam, kde Hi.Events končí (>500 sedadel, festivaly, koncerty) Tixly začíná. |
| **pretix** | Lokalizovaná alternativa pro CZ/SK trh s GoPay/Wero, plus resale marketplace s price-capem (kterou pretix vědomě neřeší). |
| **Eventbrite** | (mimo scope tohoto dokumentu — viz `eventbrite-kompletni-analyza.md`) |
| **Ticketmaster/Eventim** | (mimo scope — viz `ticketmaster-kompletni-analyza.md`, `cts-eventim-kompletni-analyza.md`) |

---

## 6. Závěr v jedné větě

**Hi.Events je rozjíždějící se start, pretix je zralá DACH platforma — ale ani jedna nemá tixly core differentiátory (resale + price-cap, TOTP, anti-scalping, multi-vertical, CZ platby), takže obě slouží jen jako benchmark pro UX, API design a plugin architekturu, ne jako foundation.**
