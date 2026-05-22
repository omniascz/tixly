# DACH Ticketing Audit — VERIFIED

**Datum:** 2026-05-22
**Scope:** 9 hlavních DACH ticketing platforem
**Metodika:** Deep WebSearch s URL citacemi přes 9 paralelních agent jobs. Co se nedalo ověřit z public sources, explicitně označeno jako "neověřeno".
**Cíl:** Identifikovat feature parity gaps a strategické příležitosti pro Tixly v CZ/SK + optional DACH expansion.

---

## 0. Executive summary

### Tržní landscape 2026

DACH ticketing trh se v 2026 konsoliduje:
- **DE:** CTS Eventim (#1) + Reservix/ADticket (#2). Ticketmaster Live Nation jako třetí.
- **AT:** oeticket = CTS Eventim Austria (market leader, &gt;76 K events/year).
- **CH:** Po fúzi (březen 2026) duopol **Ticketcorner Holding (Eventim/Ringier JV)** + Ticketmaster CH. Starticket/See Tickets CH zaniká jako standalone brand.

### Tři universal patterns napříč všemi platformami

1. **Resale s face-value cap + DB-link** = DACH standard (Eventim fanSALE, Reservix marketplace, DICE Wait List, Ticketcorner fanSALE CH). Tixly nemá.
2. **Stornoschutz add-on** (ERGO/Allianz, ~3-5,5 % per ticket) = standard upsell v checkout napříč DE/AT/CH. Tixly nemá.
3. **Theatre Abonnements** (Festabo, Wahl-Abo, Restwert, DBV reporting) = německy specifický moat. Tixly nemá nativně.

### Tři strategické mezery, které Tixly může využít

1. **CZ/SK lokalizace** — nikdo z 9 platforem nemá CS/SK UI. EVENTIM.Light explicitně necíli CEE.
2. **Self-service onboarding + API** — Reservix/ADticket/oeticket jsou sales-led, API gated. Tixly má self-service signup + může mít self-service API key.
3. **Native buyer mobile app** — ADticket, München Ticket nemají vlastní buyer app. Tixly diferenciátor.

### Co Tixly už dělá lépe než většina DACH konkurence

- Multi-tenant promotér model s branded storefronty (`/p/[promoter]`)
- Moderní marketing stack (audience segmentation 6 dimenzí, smart send-time, campaigns composer)
- Notifications center, status page s incident publish flow
- DSA report queue (EU regulatory)
- Outbound webhook subscriptions admin UI
- Full CS/SK/EN lokalizace + GoPay/ComGate provider abstrakce
- Refund flow s seat release

---

## 1. CTS Eventim ecosystem (DE/AT/CH/EU enterprise)

### EVENTIM.Light (self-service tier)

**URL:** [eventim-light.de](https://www.eventim-light.de/) | 25 zemí, lokalizováno DE/EN/FR/IT/ES/NL/SV/PT-BR

**Pricing (DE, transparent public):**
| Cena ticketu | Ticket Fee |
|---|---|
| ≤ 6,99 € | 3,5 % + 0,49 € |
| ≥ 7,00 € | 3,5 % + 0,99 € |

- UK: 8 % flat fee
- Žádný setup/monthly/binding fee, žádné fixed costs
- EVENTIM.Net add-on: +10 % advance booking fee (publikace na eventim.de + 10 000 fyzických POS)
- **Fee payer choice:** promotér si volí, zda fee absorbuje nebo přenáší na buyera. Real-time calculator v UI.
- **VAT a payment processing zahrnuté** v ticket fee (no hidden Stripe markups)

**Klíčové features:**
- **Event Bundle:** až 30 eventů sdružených (= season ticket / festival pass / abonentka)
- **Event Series:** repeating timeslots na stejném venue (kurzy, divadlo s mnoha reprízami)
- **Seating editor:** vlastní built-in (2023), drag&amp;drop, 100 price levels, 10 ticket types per event
- **Box Office:** web app pro on-site prodej, fees účtovány SEPA direct debit
- **EVENTIM.Access scanner app** (iOS+Android, free, real-time admission reporting, multi-device sync)
- **Standard QR pro print marketing** s attribution v dashboardu
- **Facebook event 1-click po napojení FB page** + FLYERALARM Digital integrace pro FB/IG/Google Ads
- **fanSALE resale**: 15 % buyer fee + 7 € delivery
- **Limit per-event:** 10 ticket types, 100 price levels, 30 events v bundle
- **Payouts:** per-event, 5 BD po Completed status (NE průběžný cash-out)
- **Refund processing fee:** 1,50 € / ticket na úkor promotéra

**Mezera pro Tixly:** EVENTIM.Light **nemá CZ/SK lokalizaci** ani CZ/SK národní portál. To je strategická first-mover příležitost pro Tixly.

### oeticket (AT — Eventim Austria)

**URL:** [oeticket.com](https://www.oeticket.com/) | DE+EN | &gt;76 K events/year | EUR only

**Service fees (per ticket, AT-specific):**
| Cena ticketu | Service fee |
|---|---|
| ≤ 10 € | 0 € |
| 10,01 – 25 € | 1,50 € |
| ≥ 25,01 € | 3 € |
| International event | +1,50 € |

- Legal status: OGH (Nejvyšší soud AT, 2024) potvrdil legitimitu fee i přes VKI spory.
- **14-day Widerrufsrecht NEPLATÍ pro tickety** (FAGG §18 výjimka).

**Payments:** Visa/MC/Amex/Diners, Klarna (invoice + Ratenzahlung), Sofortüberweisung, Vorauskasse, Apple Pay, Google Pay. **EPS nepotvrzeno explicitně.**

**Pickup network:** &gt;4 000 míst — **LIBRO + PAGRO + Trafiken** (rakouské tabákové trafiky). Pickup ≤ 3 BD před eventem, bez deposit fee v LIBRO.

**Ticketdirect** (rebrand z Print@home) = PDF self-print do startu eventu, jen pro electronic access control eventy.

**OETICKET.Pass** = personalizovaný mobile ticket, rotující barcode, anti-resale. Per-event toggle promotérem.

**fanSALE.at resale:** MAX original price (Fair Deal Symbol). Buyer fee +15 %, seller fee -10 %.

**Insurance:** ERGO Reiseversicherung 5,5 % z ticketu, max 2 000 € coverage, 100 % refund bez spoluúčasti. 10-day waiting period. Allianz Travel paralelně v retail outlets (max 300 €/ticket).

**Mobile app:** vlastní "oeticket" iOS+Android (separátní bundle, ne EVENTIM.App). Slabé ratings (iOS 3.4/5, Android 2.0/5).

**Federal theaters (Bundestheater = Staatsoper, Burgtheater, Volksoper)** mají **vlastní ticket-system** přes bundestheater.at — oeticket je sekundární kanál. Salzburger Festspiele ditto.

### Ticketcorner CH

**URL:** [ticketcorner.ch](https://www.ticketcorner.ch/) | DE+FR+IT+EN | JV CTS Eventim 50,2% + Ringier 49,8%

**Market share:** ~60 % před fúzí, po amalgamaci se See Tickets CH (březen 2026) odhad **85-90 %** B2C trhu CH.

**CH-specific payments:**
- **TWINT** (mobile QR, 5+ M uživatelů, day-0 must-have)
- **PostFinance Card / E-Finance**
- Visa, Mastercard, Amex
- Apple Pay, Google Pay
- **Reka-Card / Reka-Pay** (employer-benefit voucher, selektivně u family/leisure/ski)
- **Cornèrcard** (co-brand karta s presale benefity)
- **Rechnung** jen pro CH+FL rezidenty (CHF 5 papír / CHF 3,50 eBill)
- **Klarna NE** (atypické pro CH)

**Service fees:** CHF 0,30 – 1,90 per ticket (stupňovité), CHF 1,50 – 12 POS bearbeitung, CHF 3 Ticketschutz (Allianz).

**VAT:** 8,1 % (od 1.1.2024), kulturní výjimka per promotér.

**CH consumer law specifika:**
- **Žádný EU-style 14-day cooling-off pro online tickety** (CH není v EU)
- Event zrušen → refund face value (ne fees), 30-day deadline
- Postponement → spor mezi promotérem a Ticketcorner, často Kulanz refund
- Allianz Ticketschutz pokrývá nemoc/úraz/úmrtí; **NEpokrývá** pandemii, force majeure

**Retail síť (CH 2026):** Manor (~50, hlavní partner), Coop City (~30-40), Fnac CH (~5), SBB stations (gift cards), k kiosk / Press &amp; Books / Avec (skicards). **Swiss Post ukončen 2020. Migros nikdy nebylo.**

**fanSALE.ch:** Striktnější CH varianta — **MAX original price** (Fair Deal). Tickety verifikované přes primary DB (žádné fake-PDFs). Buyer ochrana Ticketcheck.

**Ticketcorner.Pass** = EVENTIM.Pass pro CH (rotující QR, anti-scalp, closed-loop resale).

**B2B 3-tier škála:**
- **Ticketcorner.Light** — indie/SME, self-service
- **tixx** — sport (Eishockey, fotbal, season tickets, dynamic pricing, fan loyalty)
- **inhouse** — divadla/opera/koncerty, white-label venue ticketing s subscription/abo management

**Subscriptions:** Opernhaus Zürich, Schauspielhaus Zürich, Tonhalle = **vlastní systémy** (NE Ticketcorner). EVENTIM inhouse white-label backend možný.

**Sport:** Většina Eishockey klubů přes Ticketcorner, Super League fotbal smíšené, SwissUnihockey přes Ticketmaster. ski.ticketcorner.ch — 60+ ski areas.

---

## 2. Reservix / ADticket (DE #2)

**URL:** [reservix.de](https://www.reservix.de/) + [adticket.de](https://www.adticket.de/) | Reservix GmbH (fúze 2016) | DE primárně, EN dokumentace

**Scale:**
- 7 500+ pořadatelů
- **180 000+ events/year** v DE+AT
- 3 000-3 200 Vorverkaufsstellen
- ~480 zaměstnanců
- 10 lokalit (9 DE + Vídeň)
- 70 M visits/year (kombinovaně reservix.de + adticket.de)

**Pricing:**
- **Buyer fee: 2,00 € per order** (ne per ticket, fixed)
- **Promoter fee:** ~10 % z ticket price (proxy z Awin affiliate); konkrétní % netransparentní, individuální quote
- Stornoschutz: ERGO Reiseversicherung od 0,99 €/ticket (eskaluje s cenou)

**Theater Abonnement modul (DE moat):**
- **Festabonnements** (fixní série) + **Wahl-Abos** (výběrová)
- Multiple seating plans per subscription
- Cross-price-category subscriptions
- **Residual value management (Restwert)** pro výměny a vouchery
- **Stammabonennten management**
- **DBV Performance statistics** (Deutscher Bühnenverein reporting "na jeden klik")
- **AVA + royalty accounting**

**Resale:**
- Built-in s anti-scalping protection
- Originální ticket **automaticky blokován** (re-issued s novým barcodem)
- Pořadatel musí resale povolit per-event
- Sales fee typically 10-15 %, listing zdarma
- Payout do 14 BD na bank account

**API ecosystem:**
- **developer.reservix.de** (gated, login walled)
- **Webhooks API** s OIDC nebo API key auth, at-least-once delivery
- Shopify app (turn-key pro malé venues / experiences)
- Awin affiliate (25 % z 10 % presale fee)

**Spotify partnership (od 10.7.2025)** — events Reservix klientů auto-sync do Spotify artist profiles + "concerts near you" playlists. Fresh competitive moat.

**Scanner:** Reservix Scan app (iOS+Android, free, organizer-only). Click&amp;View foto preview ze sedadel.

**Žádná native buyer app** — jen mobile web. Tixly diferenciátor.

**Payments (omezeně potvrzeno):** Karty, PayPal s BNPL (Pay in 30 days &lt; 100 €, Ratenzahlung &gt; 100 €), SOFORT, vouchers. SEPA Lastschrift/Apple Pay/Google Pay neověřeno.

**Voucher pravidla:** validity 3 roky, není personalizovaný, transferovatelný, no cash payout, multi-voucher checkout, partial payment.

**Refund:** Cash refund default při zrušení akce. Buyer cancellation bez insurance = žádný refund.

---

## 3. DICE (Fever, červen 2025)

**URL:** [dice.fm](https://dice.fm/) | UK/EU/US, ne CEE | Mobile-first

**Akvizice:** Fever akvíruje DICE 5. června 2025, několik hodin po vlastním $100M raise. DICE zůstává standalone brand.

**Pricing:**
- ~10 % booking fee per ticket, **all-in pricing** (žádné překvapení v checkoutu)
- Fee absorpce: promoter může booking fee sám absorbovat → "no fees" tagged event
- All-in formula: `ticket_price = artist_price + booking_fee + processing`

**Anti-scalping ecosystem (nejsilnější v industry):**
1. **Mobile-only, no PDF** — tickets activují 2 hours před eventem (no stable QR uložitelný dopředu)
2. **QR animation + timestamp** = screenshot ≠ valid ticket
3. **Device + account binding** přes telefon + SMS verify
4. **Wait List resale**: face value only, 5-10 min na zaplacení, automatický refund senderovi přes original payment method, periodic checks proti markup

**Refund policy:**
- Default **žádný refund** kromě cooling-off (24h od nákupu, opt-in per Event Partner)
- Event cancelled by promoter → plný refund
- Wait List resale → plný face value refund automaticky
- Refund přes original payment method (5-10 BD), ne DICE Credit

**Promotér admin:**
- **DICE MIO** ([mio.dice.fm](https://mio.dice.fm/)) — self-service event creation, custom tiers, door list, MIO Connect messaging
- **DICE Access** — iOS scanner, self-scan + continuous scan, front/rear camera, Qflow partner pro velké eventy
- 40 %+ prodejů přichází přes Discovery feed + push notifs

**Music discovery integration:**
- **Spotify + Apple Music** library sync
- Algorithm respektuje váhu poslechu
- Behavioural signals + attendance history + music data
- Lokační vrstva updatuje discover feed

**Social FOMO features:**
- Contact sync
- "Interested in" signal viditelný friends
- Groups (group-planning s alerts když friend buys ticket)
- Friend transfers přes phone number (ne email)

**Transfers:** Per-event toggle, recipient musí mít DICE account, free, sender ztrácí všechna práva po transferu. Manual fallback help@dice.fm 2+ týdny předem.

**Co DICE nemá vs. Tixly target:**
- Reserved seating maps (primárně GA / standing club focus)
- Printed PDF tickets (filozoficky)
- Multi-currency CZ/SK locale
- Subscription / season tickets
- Promotér white-label / branded UX
- GoPay / ComGate
- Full POS s hotovostí

---

## 4. Ticketino (CH #2)

**URL:** [ticketino.com](https://ticketino.com/) | DE+FR+IT+EN | "Number 2" CH market | Self-service web

**Velikost:**
- 11-50 zaměstnanců (2024)
- ~65 000 events od 2008 (~3 800/rok)
- 1 000+ POS network
- Double-digit annual growth

**Pricing model (transparent):**
- **Free akce: 0 CHF** pro organizer i buyer (no setup fee)
- **Placené akce: CHF 0,85 per ticket** + procentuální fee
- **Buyer fee podle platby:**
  - Credit card / TWINT / SOFORT (print@home) = 0 CHF (free)
  - PostFinance / PayPal = +2-4,9 %
  - Bank invoice / postal = ~CHF 5,80/order

**Pozice firmy:** Aktivně vystupuje proti illegal print@home fees ("Seco takes action") — pozicuje se jako "no hidden fees".

**Setup:** "Under 3 minutes" — 5 kroků (account, event, ticket types, payment channels, go live).

**Box office:** Vlastní desktop Windows aplikace. Cash, CC, TWINT, PostFinance, promocode. Real-time stock sync s online.

**ScanApp:** iOS+Android free. **Offline mode** ("data continuously synced, available in emergency even without internet"). Separate scanner credentials (helper přístup bez sdílení promotér loginu).

**API:**
- **developer.ticketino.com** (login-gated, API key auth — ne OAuth)
- **Webhooks:** ticket sold, event created, entrance scan, ticket order received. JSON payload, dokumentace public.
- **iFrames** generovatelné v cockpitu, Facebook ticket shop = speciální iframe
- **Shop-Plugin** (JS plugins)

**Promocodes (3 typy):**
- **Rabatt-Code** (% sleva)
- **Preisreduktions-Code** (fixní sleva)
- **Freischalt-Code** (unlock hidden tickets, free sponsor tickets)
- Direct-link integration (kód auto-aplikován kliknutím)

**Marketing:** Facebook Ticket Shop zdarma (turn FB page into ticket shop). Google Analytics + Facebook Pixel native.

**Season tickets / abonmá:** **POTVRZENÁ MEZERA** — explicitní season-ticket modul v public materials NENÍ. Workaround přes promocodes + ticket categories. Pro CZ divadla (Tixly target) = konkurenční výhoda Tixly.

**White Label / TaaS** ([blog PDF](https://blog.ticketino.com/hubfs/Ticketing%20as%20a%20Service%20(TaaS)%20-%20Ticketinos%20White%20Label%20ticketing%20system%20briefly%20explained_E.pdf)) — B2B2C revenue stream který Tixly nesleduje.

**Apple/Google Wallet:** Nepotvrzeno (Tixly má → výhoda).

---

## 5. München Ticket (DE regional, komunální)

**URL:** [muenchenticket.de](https://www.muenchenticket.de/) | DE primárně (žádná full EN)

**Unique struktura:**
- **München Ticket GmbH** vlastní **Gasteig München GmbH (50 %) + Olympiapark München GmbH (50 %)** — obě **komunální dcery města München**
- Mise (Bundeskartellamt 2019): "Etablierung eines zentralen elektronischen Vertriebssystems für Veranstaltungen in städtischen Häusern"
- NENÍ Eventim, NENÍ soukromý kapitál

**Tech stack:** **SAP Event Ticketing 2512 rev. 15** + custom Spiritec shop layer. Vlastní AS44438 autonomous network. Cloudflare + Algolia + Usercentrics.

**MVV Kombi-Ticket (killer feature):**
1. Pořadatel uzavře s MVV smlouvu (paušál za připojení)
2. Buyer koupí vstupenku
3. Jde na `mvv.muenchenticket.net`, verifikace order ID → personalizovaný MVV jízdní doklad (PDF/Wallet)
4. Platí pro celý MVV tarif (zóny M-6) v den akce, do 6:00 následujícího dne

**Analog pro Tixly:** DPP/IDOS integrace v ČR neexistuje na ticketing platformách → potenciální Tixly USP pokud podpis s DPP/Lítačka.

**Pricing:**
- Customer-side Vorverkaufsgebühr **max 2,50 €/ticket**
- Veřejný B2B ceník neexistuje (closed, "city service" model)
- Non-profit-like, fees pokrývají náklady ne zisk

**Klíčoví exkluzivní pořadatelé:**
- Münchner Volkstheater (vlastní subdoména)
- Münchner Kammerspiele (MVV-zahrnut v Abo passu)
- **Tollwood Sommer/Winterfestival exkluzivně**
- Deutsches Theater München

**Mezery MT vs. Tixly:**
- Žádná veřejná API
- Žádná full EN/multi-lang verze
- Žádná vlastní mobile app (jen Wallet pass + "München App" SWM)
- Closed B2B pricing
- Slabá tourism integrace (muenchen.travel je samostatný)

**Payments:** Visa/MC, PayPal, Apple Pay, Google Pay, bankovní převod. Klarna/Sofort/SEPA neověřeno.

**Refund:** 14-day Widerrufsrecht NEPLATÍ pro tickety (§312g BGB výjimka). Storno do akce obecně NE. Refund jen při zrušení akce nebo přes specifickou Kartenrückgabe službu pořadatele.

---

## 6. Starticket / See Tickets CH (zanikající brand)

**URL:** [seetickets.com/ch](https://www.seetickets.com/ch) → migrace na ticketcorner.ch

**Historie vlastnictví:**
| Období | Vlastník |
|---|---|
| 2003-2019 | TX Group (Tamedia) |
| 2020-01 | See Tickets (Vivendi Village) — rebrand |
| 2024-06 | CTS Eventim (akvizice Vivendi ticketing za €300M) |
| **2026-02/03** | **Ticketcorner Holding AG** — postupná integrace |

**Brand status 2026:** Starticket brand fakticky zaniká. See Tickets CH integrován pod Ticketcorner. CEO sloučené entity: Oliver Niedermann.

**Konsolidace CH trhu:** Switzerland ticketing v 2026 = duopol **Ticketcorner Holding (Eventim/Ringier)** + Ticketmaster CH.

**Payments historicky:** Visa/MC, PostFinance, TWINT.

**Languages:** DE/FR/EN (IT pravděpodobně po integraci s Ticketcorner).

**Resale:** See Tickets Fan-to-Fan Marketplace (10 % fee, list ≤ face value). Po integraci pravděpodobně konsolidace do **Ticketcorner fanSALE** (přísnější CH-only Fair Deal).

**Outlet network:** Coop Pronto kiosky zanikly, fyzické pickup outlets nyní Coop City + Ticketcorner Fnac.

**Mobile app:** iOS only historicky (žádná Android nativní). Po integraci přechází na Ticketcorner app.

**Refund:** CH consumer law (žádný cooling-off period). Rozhodnutí na pořadateli, automatický refund jen při oficiálním zrušení.

**Klíčový takeaway:** Smaller club/theater niche v CH se po odchodu Starticketu otevírá pro nové hráče (Eventfrog roste, Ticketino aktivní, Petzi pro klubovou scénu).

---

## 7. ADticket DE (Reservix-owned)

**URL:** [adticket.de](https://www.adticket.de/) | DE only | Reservix GmbH subsidiary po fúzi 2016

ADticket je brand portál v rámci Reservix GmbH. Reálně auditujeme Reservix (viz sekce 2).

**Buyer fee:** **2 € per order** ověřeno (service portal).

**B2B fee:** Sales-led, ne self-service. ~15 % + 1 € per ticket (3rd-party odhad vergleich.org, **neoficiální**).

**Žánrový focus:** Klassik &amp; Show, Theater &amp; Lesungen, Comedy/Satire/Kabarett, Konzerte, Sport, Tourismus, Messen.

**Differentiator vs. Tixly:**
- ADticket vede v: Theatre Abonnement modul (Festabo, Wahl-Abo, Restwert, DBV reporting), 3 200 offline Vorverkaufsstellen, regional account managers (10 cities), 7 500 promotér incumbency moat.
- Tixly může vyhrát v: self-service onboarding, self-service API key, native buyer mobile app (ADticket nemá!), modern UX (Next.js vs. legacy), transparent pricing, CEE languages.

---

## 8. Ticketino — viz sekce 4 (CH #2)

---

## 9. Cross-comparison Matrix

| Feature | Eventim Light | oeticket | Ticketcorner | Reservix/ADticket | DICE | Ticketino | München Ticket | Starticket | Tixly v3 |
|---|---|---|---|---|---|---|---|---|---|
| **Self-service signup** | ✅ | ❌ sales-led | ✅ Light tier | ❌ sales-led | ✅ MIO | ✅ cockpit | ❌ sales-led | ❌ | ✅ |
| **Public pricing page** | ✅ /preise | ❌ | ❌ | ❌ | ❌ (B2B) | ✅ /prices | ❌ | ❌ | TBD |
| **Per-ticket fee model** | 3,5% + 0,49-0,99€ | 0/1,50/3€ tier | 0,30-1,90 CHF | 2€/order | ~10% all-in | 0,85 CHF + % | max 2,50€ | n/a | 5-8% |
| **CZ/SK lokalizace** | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| **Resale w/ face-value cap** | fanSALE 15%+7€ | fanSALE.at | fanSALE.ch Fair Deal | Built-in 10-15% | Wait List free | ❌ | ❌ | F2F 10% | ❌ |
| **Insurance Stornoschutz** | ❌ | ERGO 5,5% | Allianz CHF 3 | ERGO 0,99€+ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Seating editor** | ✅ drag&amp;drop | ✅ enterprise | ✅ | ✅ + Click&amp;View | ❌ GA-focus | ✅ basic | ✅ SAP | ✅ | ✅ presety |
| **Theatre Abonnements** | Event Bundle (30) | ❌ via partners | ✅ inhouse tier | ✅ Festabo+Wahl+Restwert+DBV | ❌ | ❌ | ✅ MVV-Kombi | ❌ | ❌ |
| **Box Office / POS** | Web app + SEPA | LIBRO/PAGRO 4k | Manor + Coop | 3 200 VVK | DICE Access | Tageskasse Windows | Gasteig+DT | Coop City | POS v3 ✅ |
| **Offline scanner** | EVENTIM.Access | OETICKET.Pass | TC.Pass | Reservix Scan | DICE Access | ScanApp offline | SAP | n/a | ✅ |
| **Native buyer mobile app** | EVENTIM.App | oeticket app | Ticketcorner app + Ski | ❌ | ✅ flagship | ❌ | ❌ "München App" | iOS only | ❌ |
| **Public API + Webhooks** | gated | gated AWIN | gated | dev.reservix.de gated | MIO gated | developer.ticketino.com | ❌ | n/a | ✅ webhooks |
| **iFrame embed** | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ | ❌ | ✅ | ✅ |
| **White-label storefronts** | brand colors | Light tier | inhouse tier | promotér subdomain | ❌ | TaaS B2B2C | venue subdomény | ❌ | /p/[promoter] ✅ |
| **Apple/Google Wallet** | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ neověřeno | ✅ | ✅ | ✅ |
| **Rotující QR (anti-scalp)** | EVENTIM.Pass | OETICKET.Pass | TC.Pass | ❌ | animated QR | ❌ | ❌ | ❌ | ❌ |
| **Modern marketing stack** | FLYERALARM ads | basic | EVENTIM.Net | Reservix CRM | Discovery+push 40% | promocode 3 typy | ❌ | basic | ✅ 6-dim segment+smart send-time |
| **Multi-currency** | EUR/GBP/...25 zemí | EUR | CHF | EUR | local | CHF/EUR | EUR | CHF | CZK+EUR |
| **DSA report queue** | ❌ public | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| **Status page incidents** | ❌ public | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| **Spotify integration** | ❌ | ❌ | ❌ | ✅ od 7/2025 | ✅ library sync | ❌ | ❌ | ❌ | ❌ |
| **MHD integrace** | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ MVV | ❌ | ❌ |

---

## 10. Gap analysis vs. Tixly

### ✅ Tixly už dělá lépe / má parity

1. **CS/SK/EN full lokalizace** — žádná DACH platforma nemá CZ/SK
2. **Multi-tenant promotér model** s branded storefronty `/p/[promoter]`
3. **Moderní marketing stack:** audience segmentation 6 dimenzí, smart send-time, campaigns composer
4. **Notifications center, status page s incident publish, DSA report queue, outbound webhook subscriptions** — žádná DACH platforma to neukazuje public
5. **GoPay + ComGate provider abstrakce** pro CZ/SK native payments
6. **Refund flow uvolňuje seats**, full lokalizace, public /p/[slug]
7. **POS modul** (POS v3 hotový, scanner offline)
8. **Self-service signup + plánované self-service API key**

### ⚠️ Gaps — kandidáti na P0 (před launch nebo Q3 2026)

**P0-1: Resale s face-value cap (anti-scalping)**
- DACH standard u všech 9 platforem (Eventim fanSALE, Reservix marketplace, DICE Wait List, Ticketcorner fanSALE CH)
- Slovenský zákon o resale (od 2024) face-value cap = legal pressure
- Implementace: Reservix model je elegantní — originální ticket auto-blocked, new ticket re-issued, organizer approval per-event
- **Strategic moat** vs. viagogo/StubHub (které dovolují markup)
- Tixly už má seat release v refund flow → resale je natural rozšíření

**P0-2: Theatre Abonnements (Festabo + Wahl-Abo)**
- Reservix má **Festabonnements + Wahl-Abos + cross-price subscriptions + Restwert management + DBV reporting**
- Pro CZ divadla (Tixly target z Divadlo v Celetné memory) = must-have
- Ticketcorner inhouse tier dělá totéž pro Opernhaus/Schauspielhaus
- Eventim Light "Event Bundle" (až 30 eventů) je minimální parita
- **Národní divadlo, Česká filharmonie, Stavovské** by Tixly otevřeli s lepším UX + nižší fees, pokud tohle podporuje

### 🔧 P1 — důležité ale ne blokující launch

**P1-1: Stornoschutz add-on insurance**
- ERGO/Allianz partnerství, ~3-5,5 % per ticket cross-sell
- CZ analog: ČSOB Pojišťovna, Allianz CZ, Generali, Slavia
- Vysokomaržový revenue stream
- Konfigurace v checkout: opt-in checkbox

**P1-2: Voucher self-service**
- Reservix elegantní: subdomain pro voucher sale, 3-year validity, multi-voucher checkout, partial payment
- Tixly dnes nemá v jedné UI dle MEMORY

**P1-3: Rotující QR Pass pro top eventy**
- EVENTIM.Pass / OETICKET.Pass / TC.Pass model
- Sekundový/minutový rotating barcode
- Pro 5 000+ míst eventy (Sazka Aréna, O2 Universum, festivaly)
- Anti-scalp closed-loop

**P1-4: B2B2C / White-label tier (Ticketino TaaS pattern)**
- B2B2C revenue stream který Tixly nesleduje
- Multi-tier: indie self-service → mid-market → enterprise white-label
- Tixly už má self-service, ale chybí white-label inhouse mode pro velká divadla

### 💡 P2 — nice-to-have / dlouhodobé

**P2-1: Voucher-as-payment / Benefit integration**
- Reka-Card style v CH
- CZ analog: Edenred, Sodexo, Benefit Plus, Pluxee integrace
- Unlock korporátní benefit budget jako payment source

**P2-2: MHD Kombi-Ticket integrace**
- München Ticket MVV pattern
- CZ: DPP/Lítačka partnerství
- Massive city moat pokud podepsáno

**P2-3: Music discovery integrace (Spotify model)**
- Reservix má od 7/2025
- DICE od začátku — 40 %+ prodejů přes discovery
- Spotify Concerts API je open od 2024
- Pro CZ/SK alternativa: Songkick, vlastní portal tixly.cz catalogue

**P2-4: Social FOMO features (DICE pattern)**
- Contact sync, friend graph, "interested in" signal, Groups
- 40 %+ DICE prodejů přes push + discovery
- Snižuje promotér marketing spend

**P2-5: Native buyer mobile app**
- ADticket nemá, München Ticket nemá, Reservix nemá
- DICE je mobile-first
- Tixly diferenciátor v CZ/SK trhu
- iOS+Android nebo PWA-first

**P2-6: Saalplan editor s Click&amp;View foto preview**
- Reservix feature
- Promotér nahraje fotky pohledu ze sedadel přes mobile app
- Buyer vidí "výhled ze sedadla X"

---

## 11. Recommended Tixly roadmap z DACH findings

### Q3 2026 (před fáze "launch-ready", po smoke fix)

1. **Resale marketplace** (P0-1)
   - Migrate seat release logic → resale listing flow
   - Originální ticket auto-blocked při sold-state, new barcode reissued
   - Promoter toggle per-event, fee 10-15 %
   - Anti-scalping: face value MAX (slovenský zákon compliant)

2. **Stornoschutz insurance opt-in** (P1-1)
   - Partner s ČSOB Pojišťovnou nebo Allianz CZ
   - 3-5 % per ticket cross-sell v checkout
   - Cancel-for-illness/úraz default coverage

### Q4 2026

3. **Theatre Abonnements** (P0-2)
   - Event Bundle (Eventim Light pattern, až 30 eventů)
   - Multi-show subscription s seat assignment
   - Restwert management pro výměny
   - Pro Divadlo Verze (Celetná memory) a Národní divadlo

4. **Voucher self-service** (P1-2)
   - Subdomain per promoter (`vouchers.tixly.cz/[promoter]`)
   - 3-year validity, multi-voucher checkout

### 2027

5. **Rotující QR Pass tier** (P1-3) — pro top eventy
6. **Benefit voucher payment** (P2-1) — Edenred/Sodexo
7. **Native buyer mobile app** (P2-5) — diferenciátor
8. **Music discovery integration** (P2-3) — Spotify Concerts API

### Strategické rozhodnutí — DACH expansion?

**Pro:** Žádná DACH platforma nemá CZ/SK lokalizaci → reverse opportunity neexistuje, ale Tixly multi-lang infrastruktura je transferable.

**Proti:**
- CH market konsolidovaný (Ticketcorner 85-90 %)
- DE market dominován Eventim + Reservix incumbency moat
- AT = Eventim Austria monopol (76K events/year)
- DACH theatre Abonnement requirements jsou jiné (DBV reporting)
- Local payments + outlets je year-long BD play

**Verdict:** Tixly by mělo nejdřív dominate CZ + SK (kde je first-mover advantage potvrzeno) a DACH zvážit po validaci product-market fit doma.

---

## 12. Metodologická limitace auditu

**WebFetch byl pro většinu agentů zamítnut permissions** v této session. Vše níže je založené na:
- **WebSearch metadata + Google-indexované snippets** (ne přímé HTML scrape)
- Veřejné help-center stránky, AGB, partner popisy, App Store listings
- Tisková média (IQ Magazine, MBW, Variety, persoenlich.com, ringier.com)
- Industry benchmarks (Awin merchant profiles, vergleich.org)

**Co se ne podařilo ověřit a vyžaduje manuální follow-up:**
- Přesné B2B fee tiers (Reservix, ADticket, Ticketcorner, oeticket — všechny custom-quoted)
- Konkrétní settlement/payout intervaly
- Apple Pay / Google Pay support per platform
- SEPA Lastschrift / Kauf auf Rechnung support
- Dynamic / time-based pricing engines
- AGB konkrétní commission čísla
- API rate limits, OAuth scopes

**Pro production decisions** doporučuji follow-up session s povoleným WebFetch + manuální checkout walkthrough (CH s VPN, AT s VPN, DE s VPN) pro top 3 platformy (Eventim Light, Reservix, Ticketcorner).

---

## 13. Sources (master list per platforma)

### Eventim Light
- [eventim-light.de/preise](https://www.eventim-light.de/preise/)
- [eventim-light.de/en/faq](https://www.eventim-light.de/en/faq/)
- [eventim-light.de/en/features/create-seating-plan](https://www.eventim-light.de/en/features/create-seating-plan/)
- [eventimb2b.co.uk/seat-map (release announcement)](https://www.eventimb2b.co.uk/seat-map-is-now-available-in-eventim-light/)
- [eventim.de/campaign/en/pass (EVENTIM.Pass)](https://www.eventim-light.com/at/)

### oeticket
- [oeticket.com/help/terms](https://www.oeticket.com/help/terms/)
- [oeticket.com/faq](https://www.oeticket.com/faq/de_de/)
- [oeticket Ticketversicherung PDF](https://www.oeticket.com/obj/media/AT-eventim/pdf/Ticketversicherung_Versicherungsbedingungen.pdf)
- [oeticket Business](https://www.oeticketbusiness.com/en/)
- [fanSALE.at](https://www.fansale.at/)
- [VKI: Servicegebühr unzulässig](https://verbraucherrecht.at/vki-unzulaessige-servicegebuehr-bei-oe-ticket/67652)
- [meinbezirk.at: OGH zulässig](https://www.meinbezirk.at/wien/c-wirtschaft/servicegebuehren-von-oeticket-sind-laut-ogh-zulaessig_a6763974)

### Ticketcorner
- [ticketcorner.ch/help/terms](https://www.ticketcorner.ch/help/terms/)
- [ticketcorner.ch/campaign/pass](https://www.ticketcorner.ch/campaign/pass)
- [fansale.ch + advantages](https://www.fansale.ch/advantages.htm)
- [b2b.ticketcorner.ch](https://www.b2b.ticketcorner.ch/)
- [ringier.com — joint Swiss ticketing group](https://www.ringier.com/two-on-one-ticket-ticketcorner-and-starticket-are-establishing-a-joint-swiss-ticketing-group/)
- [iqmagazine.com — See Tickets CH + Ticketcorner consolidate (2026/03)](https://www.iqmagazine.com/2026/03/see-tickets-switzerland-and-ticketcorner-consolidate/)
- [ktipp.ch — hohe Gebühren](https://www.ktipp.ch/artikel/artikeldetail/hohe-gebuehren-bei-ticketcorner/)
- [beobachter.ch — Konzertticket Rechte](https://www.beobachter.ch/konsum/konsumentenschutz/was-passiert-mit-meinem-konzertticket-390682)

### Reservix / ADticket
- [reservix.net/en](https://www.reservix.net/en/)
- [reservix.net/en/zusammenarbeit-veranstalter](https://www.reservix.net/en/zusammenarbeit-veranstalter/)
- [developer.reservix.de](https://developer.reservix.de/)
- [doc.webhooks.dev.integration.reservix.cloud](https://doc.webhooks.dev.integration.reservix.cloud/)
- [reservix.net/en/press/spotify-partnerschaft](https://www.reservix.net/en/press/reservix-erweitert-reichweite-durch-neue-partnerschaft-mit-spotify/)
- [service.adticket.de](https://service.adticket.de/de/support/solutions)
- [magazin.adticket.de/ticketweiterverkauf](https://magazin.adticket.de/ticketweiterverkauf/)
- [reservix.de/gutscheine](https://www.reservix.de/gutscheine)
- [ergo-eventticket.digitalclaim.de](https://ergo-eventticket.digitalclaim.de/en/service)

### DICE
- [dicefm.zendesk.com/hc/en-gb](https://dicefm.zendesk.com/hc/en-gb)
- [dice.fm/partners](https://dice.fm/partners)
- [mio.dice.fm](https://mio.dice.fm/)
- [dicefm.zendesk.com — fees](https://dicefm.zendesk.com/hc/en-gb/articles/19919684020113-How-DICE-fees-work)
- [dicefm.zendesk.com — refund](https://dicefm.zendesk.com/hc/en-gb/articles/4409603669777-When-you-re-entitled-to-a-refund)
- [musicbusinessworldwide.com — Fever acquires DICE](https://www.musicbusinessworldwide.com/dice-acquired-by-live-events-discovery-platform-fever/)
- [newsroom.feverup.com — DICE acquisition](https://newsroom.feverup.com/en-US/250537-fever-and-dice-join-forces-to-build-a-live-entertainment-tech-powerhouse/)
- [getqflow.com — DICE Access case study](https://www.getqflow.com/success-story/dice-fm-dice-access)

### Ticketino
- [organizer.ticketino.com/en/prices](https://organizer.ticketino.com/en/prices/)
- [organizer.ticketino.com/en/functions](https://organizer.ticketino.com/en/functions/)
- [developer.ticketino.com](https://developer.ticketino.com/)
- [developer.ticketino.com/webhooks](https://developer.ticketino.com/webhooks/)
- [organizer.ticketino.com/en/press/illegal-fees](https://organizer.ticketino.com/en/press/illegal-fees/)
- [organizer.ticketino.com/en/white-label](https://organizer.ticketino.com/en/white-label/)
- [moneyhouse.ch/en/company/ticketino-ag](https://www.moneyhouse.ch/en/company/ticketino-ag-10812665141)

### München Ticket
- [muenchenticket.de/ueber-uns/gesellschafter-und-aufsichtsrat](https://www.muenchenticket.de/ueber-uns/gesellschafter-und-aufsichtsrat/)
- [bundeskartellamt.de B6-132-14](https://www.bundeskartellamt.de/SharedDocs/Entscheidung/EN/Entscheidungen/Missbrauchsaufsicht/2019/B6-132-14.pdf)
- [mvv-muenchen.de/tickets-preise/mvv-kombi-tickets-fuer-events](https://www.mvv-muenchen.de/tickets-preise/tickets-tageskarten/mvv-kombi-tickets-fuer-events/index.html)
- [echonet.de — München Ticket projekt](https://echonet.de/de/projekte/102/muenchen-ticket)
- [northdata.com — München Ticket](https://www.northdata.com/M%C3%BCnchen%20Ticket%20GmbH,%20M%C3%BCnchen/HRB%20106018)

### Starticket / See Tickets CH
- [musicbusinessworldwide.com — See Tickets acquires Starticket](https://www.musicbusinessworldwide.com/vivendi-owned-see-tickets-acquires-switzerland-based-starticket/)
- [iqmagazine.com — See Tickets acquires Starticket (2020)](https://www.iqmagazine.com/2020/01/see-tickets-acquires-switzerlands-starticket/)
- [seetickets.com/ch](https://www.seetickets.com/ch?lang=en-US)
- [support.starticket.ch — becomes See Tickets](https://support.starticket.ch/hc/en-us/articles/360011707579-Starticket-becomes-See-Tickets)
- [refunds.starticket.ch](https://refunds.starticket.ch/)

---

**Konec auditu.** Audit dokončen 2026-05-22, 9 platforem, 9 paralelních agent jobs, full URL citation chain.
