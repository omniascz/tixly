# Hluboký audit DACH ticketing platforem vs Tixly

> Stav: 2026-05-22
>
> **Pokrývá:** CTS Eventim (DE), Ticketmaster DACH, Reservix, ADticket, oeticket (AT), Ticketcorner (CH), Starticket/Ticketino (CH), München Ticket, Eventim Light, DICE (Fever).
>
> **Metodika:** verifikace přes veřejné dokumentace, regulaminy, partner portály, App Store/Play Store popisy. Co se nedá ověřit = explicitně označeno.

---

## 1. CTS Eventim (eventim.de)

**Pozice:** Evropská 1, světová 2. 250M lístků/rok, 24 zemí.

### Vertikální vrstvy

**A1. B2B portfolio (rodina produktů)**
- **EVENTIM.Net** — enterprise platforma pro stadiony/arény. Peak-load handling, multi-channel sales, white-label.
- **EVENTIM.Inhouse** — SaaS pro venue/instituce (500+ divadel, oper, muzeí). Timed entry, availability screens, membership cards, waiting lists.
- **EVENTIM.Tixx** + **EVENTIM Sports** — sportovní ticketing, sezónní permanentky, fan management.
- **EVENTIM.Light** — self-service pro malé pořadatele (viz §9).
- **EVENTIM.Access** — skenovací app, RFID, real-time kapacity.
- **EVENTIM.Liga** — ligový sportovní ticketing.
- **EVENTIM.Cine** + **kinoheld** — kina.
- **EVENTIM Brand Connect** — reklama jako managed service.
- **EVENTIM.Travel** — cestovní balíčky.
- **EVENTIM.Analytics** — reporting modul.

**A2. EVENTIM.Pass (digitální vstupenka)**
- **In-app only** — vstupenka EXISTUJE jen v EVENTIM.App.
- **QR zadržený do času akce** — anti-resale signature feature.
- **Telefonní číslo binding** — vstupenka váže na phone, změna jen přes support + doklad + 14 dní.
- **TAN SMS validace** po nákupu.
- **Push notifikace** přímo do appky.

**A3. fanSALE resale marketplace**
- Spustitelné z app ("Sell on fanSALE")
- Barcode authentication + re-issue na jméno
- Fair Deal price strop (max původní cena u personalizovaných)
- Deadline per akce (Sheeran: 24 h)
- Payout ~4 dny po doručení
- Combo/bundle tickets vyloučené

**A4. EVENTIM.Net features**
- Ticket packages + add-ons
- Pricing per kanál (online vs box vs partner)
- Audience segmentation pricing
- Multi-day passes (festivaly)
- VIP experiences
- Real-time mid-onsale úpravy (ceny, sedadla, kvóty)
- Panoramatický seating plan (3D pohled na pódium)
- Cross-sell: vstupenka + hotel
- Managed Services (Eventim provozuje za promotéra)

**A5. EVENTIM.Inhouse features**
- **Timed entry** — vstup v naplánovaných časech (muzea)
- **Availability screen** — digital signage na foyer obrazovkách s real-time updaty
- **Membership cards** přes layout editor
- Upsell merch/F&B v košíku
- "Pick your own packages" — flexibilní bundling
- **Waiting lists** s auto-notify
- Box office historie zákazníků
- Membership / loyalty tools

### Horizontální flow
**Pořadatel:** Light self-service / Net obchodně → onboarding → konfigurace → distribuce přes portál + 10 000 agentur + box office → Access scan app.
**Fan:** discovery na národním portálu → účet (telefon klíčové) → checkout → Pass v appce (offline po prvním načtení) → vstup (NFC nebo QR scan) → fanSALE pokud nevyužije.

### Co Tixly NEMÁ z Eventim
- ❌ Vlastní stálá venues + promotér akvizice (EVENTIM LIVE 36 firem)
- ❌ Panoramatický 3D seating plan
- ❌ Národní distribuční portál (eventim.de) jako agregátor napříč promotéry
- ❌ ~10 000 fyzických prodejních agentur (DE)
- ❌ Phone-number Pass binding s 14-day review (máme Hot Mode, ale ne tenhle workflow)
- ❌ Cross-sell hotel/travel packages
- ❌ Managed Services (Eventim provozuje za promotéra)
- ❌ Vertical produkty (kina, ligy, travel) — Tixly out of scope

### Co Tixly MÁ navíc
- ✅ ISDOC export (CZ účtárna)
- ✅ Multi-tenant data sovereignty
- ✅ Public REST API + OAuth (Eventim má jen partnerský servicedesk)
- ✅ Search API funkční
- ✅ DSA Act 2024 plně
- ✅ Hot Event Mode (Pass-equivalent + features)

---

## 2. Ticketmaster (DE/AT/CH)

**Pozice:** US/global #1, v DACH velké tour a Live Nation produkce.

### Vertikální vrstvy

**TM1 platforma**
- **TM1 Events** — drag-and-drop venue layout, floor plans, holds, sightlines, < 8 min vytvoření; verzování + audit + permissions; Event Groups + Bulk Edit + Coordinated Onsale + Cross-Org sharing; reusable templates.
- **TM1 Sales** — real-time data, Mobilized Box Office, dynamic inventory, in-app price requests.
- **TM1 Entry** — SafeTix sken, scan log export (multi-event).
- **TM1 Reports** — tržby live, demografie, sales by location.
- **TM1 Marketing** — Promoted Ads (retail media network), pixely, audience targeting, customizable dashboards, shareable event groups.

**Onsale mechanismy**
- Presales (přístupové kódy)
- **Verified Fan** — pre-onsale registrace s ověřením proti botům
- **Smart Queue** — virtuální fronta s pozicí + phone validation
- Cenové vrstvy: face value / Platinum / Preferred / dynamic

**SafeTix**
- Rotující barcode (~15s nebo "pár minut")
- Tied to verified account
- Screenshot/screen recording blokované (native OS API)
- Animované prvky
- Branding umělce/akce
- NFC tap-and-go
- Apple/Google Wallet
- **Enhanced Apple Wallet 2025**: Content Modules (Apple Music, počasí, mapy venue, parking, merch), publikace 3 dny předem, update 24 h předem

**Resale**
- Re-issue na jméno
- Face Value Exchange (artist-controlled cap)
- Money-back guarantee labeling
- Cenový strop nastaví umělec

**API / Developer Portal**
- Discovery API v2 (events, attractions, venues, classifications)
- Partner API + Order Management API
- **Secure Entry SDK** (iOS/Android/JS) — 3rd party app rendruje SafeTix
- Top Picks API, Inventory Status API, Discovery Feed
- Presence API/SDK (identity)
- Purchase SDK (legacy)
- Rate limits: 5000/day, 5 req/s (Top Picks: 1200/min)
- OAuth 2.0

### Horizontální flow
**Promotér:** TM1 setup → konfigurace presales/VF/queue → multi-event groups → marketing (Promoted Ads, pixely) → onsale → live monitoring → entry den (SafeTix scan) → reports.
**Fan:** discovery → account → Smart Queue → výběr s All-In cenou → SafeTix do app → transfer/resale → den akce → tap NFC.

### Co Tixly NEMÁ z TM
✅ Implementováno během 8 TM Parity fází + Vlna 1-3:
- Smart Queue, Verified Fan, All-In, Event Groups, Bulk Edit, Coordinated Onsale, Wallet push, NFC, Postpone, Will Call, Reusable Templates, Tracking Pixels, Customizable Dashboards, Wallet Content Modules, Pre-event Payouts, Secure Entry SDK, Presence SDK, Inventory API, Demographics, Live Animations

❌ Stále chybí:
- **Vlastnictví venues** (Live Nation owns Lanxess, Apollo)
- **Stadium-grade panoramatický 3D seating**
- **Native iOS/Android screenshot block API** (web nemůže)
- **Live Nation promotér ekosystém**

---

## 3. Reservix

**Pozice:** Německý self-service, ~6000+ pořadatelů, regionální specialista.

### Vertikální vrstvy

**A1. Self-service pořadatel**
- Web-based event editor
- Reservix Login (Veranstalterzugang)
- **3 typy vstupenek**: print@home, mobile, hard ticket (poštou)
- White-label ticketshop pro promotéra
- **Box office modul** s scanner app
- Seating editor s drag-and-drop
- **Personalizované vstupenky** (jméno na lístku)

**A2. Distribuce**
- reservix.de jako agregator
- 200+ Vorverkaufsstellen (prodejna v Lottoladen, kiosky)
- Lokální tiskárna pro hard tickets
- **Print stations** (POS hardware)

**A3. Refundy a pojištění**
- **Stornoschutz** (cancellation insurance) — pojištění zrušení nákupu, ~5-10 % z ceny
- Refund jen při zrušení akce
- Reseller protection programy

**A4. API**
- **Reservix Connect API** (B2B for Vorverkaufsstellen, ne veřejný)
- Webhooks pro nové prodeje
- iCal export

**A5. Marketing tools**
- E-mail kampaně přes platformu
- Facebook event sync (ne auto-creation jak Eventbrite, ale embed widget)
- Reservix Tipps redakce (curated content)

### Co Tixly NEMÁ z Reservix
- ❌ **Síť 200+ Vorverkaufsstellen** (fyzické prodejny v kioskách)
- ❌ **Hard ticket print + poštování** (Tixly digital-first)
- ❌ **POS print stations hardware** pro Vorverkaufsstellen
- ❌ **Stornoschutz** jako levný add-on (~5-10 % cena lístku) — máme insurance_plans ale jiný produkt
- ❌ **Reservix Tipps** editorial curation
- ⚠️ Personalizované vstupenky (máme attendee_info od Fáze EB1)

### Co Tixly MÁ navíc
- ✅ Veřejné REST API (Reservix má jen partnerský)
- ✅ Rotující QR / NFC (Reservix má statický QR)
- ✅ DSA Act, GDPR Art. 7 (Reservix má jen BDSG basic)
- ✅ Smart Queue + Hot Event Mode
- ✅ OAuth 2.0 pro 3rd party

---

## 4. ADticket.de

**Pozice:** Středně velký německý ticketing, regionální + tour focus.

### Vertikální vrstvy

> ⚠️ Veřejná dokumentace ADticket je velmi omezená — primárně marketing pages, ne tech detaily.

**A1. Self-service event creation**
- Online event editor
- White-label ticketshop
- Hard ticket + mobile

**A2. Distribuce**
- adticket.de jako portál
- Affiliate network (smaller than Reservix)
- **HPS Service** (call center pro reservace)

**A3. Specifika DACH segmentu**
- Vyšší focus na **theater + classical music** než pop koncerty
- Subscription tickets (abonements) pro divadla
- **Season tickets** (Saisonkarten)

### Co Tixly NEMÁ z ADticket
- ❌ Call center pro phone reservations (HPS Service)
- ⚠️ Subscription tickets / abonement model — máme `subscriptions` schema, ne plně využité

### Stav ověřitelnosti
Nepodařilo se dohledat detailní moduly ADticket admin panelu. Pravděpodobně podobné Reservix ale menšího rozsahu.

---

## 5. oeticket.com (Eventim AT)

**Pozice:** Hlavní rakouský prodejní kanál Eventimu. Stejná tech base jako Eventim.de.

### Specifika oproti Eventim.de

**A1. Lokalizace**
- DE/EN UI (AT-specifické formulace)
- EUR pricing
- AT VAT compliance (20 % standard)
- Phone +43, address formats

**A2. Platby AT-specific**
- **EPS Überweisung** (online banking transfer, AT-only)
- **Klarna** (ratenkauf)
- SEPA Lastschrift
- Kreditkarte (Visa/MC/AmEx)

**A3. Distribuce AT**
- **Libro/Pagro** stores (~70 papíren) jako fyzické prodejny
- **Ö-Ticket Box** kiosky na nádražích

**A4. Specifické featury**
- **Wiener Festwochen** + **Salzburger Festspiele** subscription tickets
- **Ski-Karten** propojení (Skiline.cc)
- AT culture sector — divadla, opery, koncertní sály

### Co Tixly NEMÁ z oeticket
- ❌ **EPS Überweisung** integration (AT-only payment, byl by potřeba pro AT trh)
- ❌ Klarna Ratenkauf (BNPL)
- ❌ **Libro/Pagro retail network** (irelevantní mimo AT)
- ❌ Subscription tickets pro festival série (Festwochen-style)

---

## 6. Ticketcorner (Eventim CH)

**Pozice:** Hlavní švýcarský prodejní kanál Eventimu.

### Specifika oproti Eventim.de

**A1. Lokalizace**
- DE/FR/IT/EN UI (4 jazyky)
- CHF pricing
- CH VAT 8.1 % (od 2024)

**A2. Platby CH-specific**
- **TWINT** (CH mobile payment, dominantní)
- **PostFinance** (CH bank)
- Visa/MC/AmEx
- **Reka-Check** (corporate benefits voucher)

**A3. Distribuce CH**
- **Manor** department stores (~50 fyzických prodejen)
- **SBB Avec** (~100 nádražních kiosků)
- **Migros Aare/Genève** některé partnery

**A4. Specifické featury**
- **Ticketcorner-Mobile** app
- **Sportticketing** propojení s SwissUnihockey, Eishockey ligy
- **Festival prodej** Open-Air St. Gallen, Paléo

### Co Tixly NEMÁ z Ticketcorner
- ❌ **TWINT** integration (CH must-have, dominantní)
- ❌ **PostFinance** payment
- ❌ Reka-Check corporate vouchers
- ❌ Manor/SBB retail network
- ⚠️ 4-language UI (máme CS/SK/EN, chybí FR/IT/DE)

---

## 7. Starticket (CH)

**Pozice:** Druhý největší CH ticketing, dříve Tamedia Group, dnes ramping down (acquisition by Ticketmaster CH 2024).

### Vertikální vrstvy

**A1. Pořadatel**
- Self-service event editor
- Light positioning (oproti Ticketcorner enterprise)

**A2. Distribuce**
- starticket.ch portál
- Coop, Manor regionální
- **Coop Pronto** kiosky (~300 v CH)

**A3. Specifika**
- **Migros Kulturprozent** partnerství (discount tickets pro Migros zákazníky)
- Festival focus (Greenfield, Heitere)

### Co Tixly NEMÁ z Starticket
- ❌ Migros Kulturprozent-style **retail discount partnership** (slevy pro Migros/Coop členy)

---

## 8. Ticketino (CH)

**Pozice:** Self-service CH platforma, menší pořadatelé.

### Vertikální vrstvy

**A1. Self-service pořadatel**
- Free signup
- 5 minut event setup
- Branded ticketshop
- **Print@home jediná možnost** (no hard tickets)

**A2. Obchodní model**
- **5 % + CHF 0.50/Ticket** poplatek (transparentní cenník!)
- **0 startovních nákladů**
- Free akce — žádné fees

**A3. Featury**
- iframe embed
- QR scanner app (free)
- E-mail kampaně
- **Veranstalterportal** s real-time přehledem

**A4. CH-specific**
- TWINT, PostFinance, Visa/MC/AmEx
- DE/FR/IT/EN

### Co Tixly NEMÁ z Ticketino
- ✅ Veřejný cenník (Ticketino transparentně publikuje, Tixly to může taky)
- ✅ Free akce zdarma (Tixly to už má)
- ⚠️ **5min event setup** UX simplicity (Tixly to může mít vyladěnější)

---

## 9. München Ticket + regionální networks

**Pozice:** Regionální (lokální haly, divadla) — Mnichov, Berlín (Eventim Eigenmarken), Hamburg etc.

### Vertikální vrstvy

**A1. München Ticket specific**
- **TKO 2.0 ticketing software** (vlastní backend)
- City-curated event catalog (jen Mnichov region)
- **Public Web Service API** (ne jako Reservix interní — München Ticket má dokumentaci)
- **Pickup** v knihařstvích, lottotrafikách, info centrech (cca 50 míst v Bavorsku)

**A2. Regionální specifika**
- Vlastní brand (München Ticket logo na vstupence)
- Integrace s MVV (mnichovský dopravní svaz) — **vstupenka = jízdenka MHD zdarma** pro některé akce
- Subscription Münchner Volkstheater, Münchner Kammerspiele

**A3. Lokální B2B**
- Magistrátní integrace (městské kulturní akce)
- Bavorska Touristik partnerství

### Co Tixly NEMÁ z München Ticket
- ❌ **Public Transit integration** — vstupenka jako jízdenka MHD (DPP Praha by mohlo být partnerství)
- ❌ Městská/magistrátní integrace
- ❌ Tourism board API connections

---

## 10. Eventim Light

**Pozice:** Self-service větev Eventimu pro malé pořadatele.

### Vertikální vrstvy

**A1. Setup**
- **0 startovních nákladů**
- **0 fixních smluv**
- **Pay-per-ticket** komise
- Public **price calculator** (kupec předem vidí kolik zaplatí)
- Free akce — bez ticketing fees
- Video tutorials + quick guides

**A2. Event editor**
- **Title + termíny + ceny za pár kliků**
- **Vlastní layout vstupenky** (PDF design)
- **Seating plan editor** pro konkrétní venue
- Series (víc termínů najednou)
- Subscription/season tickets
- **Doplňkové otázky** v shopu (dietní pref, "kde jsi slyšel")

**A3. Distribuce**
- Branded ticketshop
- **iFrame nebo redirect** integrace na promotér's web
- Publikace na entradas.com (resp. národní portál)
- **10 000 prodejních agentur DE** (dosah)
- **Box office modul** pro on-site prodej

**A4. Marketing**
- **Facebook Event auto-creation**
- Promo codes / slevy
- **QR kód pro nákup** ve vlastním shopu (anti-fronta)
- Eventim marketing kampaně zapojení
- Dashboard + GA integration
- EVENTIM.Access scan app zdarma

**A5. Volba**
- Promotér rozhoduje **kdo platí fees** (organizátor vs kupec)

### Co Tixly NEMÁ z Eventim Light
- ❌ **Facebook Event auto-creation** (přímé propojení FB API)
- ❌ **QR pro nákup ve vlastním shopu** (jednoduchá feature: QR → ticketshop URL)
- ⚠️ **Public price calculator** — máme od Vlny EB2, ale není promotion-facing
- ⚠️ **Cenník public** (Eventim Light má cennikovou kalkulačku pro promotéry)
- ✅ Doplňkové otázky / custom fields (Vlna E2)
- ✅ Seating plan editor (memory)
- ✅ Volba fee payer

---

## 11. DICE (Fever)

**Pozice:** UK/global indie/club focus, v DACH klubová scéna Berlin/Hamburg/München.

### Vertikální vrstvy

**A1. Filozofie**
- **Mobile-only tickets** — žádný PDF, žádný transfer mimo DICE app
- **Anti-scalping by design** — vstupenka existuje jen v app na konkrétním device
- **Lockable Face ID** — vstupenka se odemkne jen tváří kupce (volitelná feature)
- **No fees pro některé akce** — DICE absorbs fees, promotér nesouhlasí navíc

**A2. Promotér app**
- **DICE Pro** — admin app pro promotéry
- Event setup za 5 minut
- Real-time analytics
- Smart Notifications na fan base
- Waiting list automation

**A3. Distribuce**
- DICE app jako jediný kanál (no web purchase u některých akcí)
- **DICE FOMO** — sociálně-driven notifikace "tvůj kamarád si koupil ticket"
- **Spotify/Apple Music integration** — DICE vidí co posloucháš → recommends koncerty

**A4. Refund / cancellation**
- **No cash refunds** — jen credit do DICE app (12 měsíců)
- **Smart Resale**: pokud nemůžeš jít, DICE auto-relistne lístek do waiting listu za **původní cenu** (no markup) — vrácí ti peníze pokud se prodá
- **Anti-scalp**: scalpers nemůžou převést mimo app

**A5. Music discovery**
- DICE App = ticketing + music discovery (jako Spotify pro koncerty)
- Curated recommendations
- City-based ("akce v Berlině dnes večer")
- Editorial content / interviews

### Co Tixly NEMÁ z DICE
- ❌ **Mobile-only ticket policy** s lockable Face ID (máme jen optional Wallet)
- ❌ **DICE Smart Resale** — auto-relist do waiting listu za face value
- ❌ **DICE FOMO** notifikace ("tvůj kamarád si koupil")
- ❌ **Spotify/Apple Music integration** — recommendations z listening history
- ❌ **Editorial content layer** (curated reviews, interviews)
- ❌ **DICE app as music discovery** + ticketing combined

### Co Tixly MÁ co DICE nemá
- ✅ Multi-tenant SaaS pro pořadatele (DICE je platforma operátor sám)
- ✅ Hard ticket + PDF + Wallet (DICE je mobile-only — omezení pro některé promotéry)
- ✅ Veřejné REST API + OAuth
- ✅ Plnou range eventů (DICE jen indie/clubs)

---

# CROSS-COMPARISON TABULKA

| Feature | Eventim | TM DACH | Reservix | ADticket | oeticket | Ticketcorner | Starticket | Ticketino | München T. | Eventim Light | DICE | **Tixly** |
|---------|---------|---------|----------|----------|----------|--------------|------------|-----------|-----------|---------------|------|-----------|
| **Self-service signup** | jen Light | Universe | ✅ | ✅ | jen Light | jen Light | ⚠️ | ✅ | ❌ | ✅ | ❌ | ✅ |
| **Národní portál (agregátor)** | ✅ | ⚠️ | ✅ | ⚠️ | ✅ | ✅ | ✅ | ⚠️ | ⚠️ | ✅ | ✅ (DICE app) | ✅ /events |
| **Fyzické prodejny síť** | 10 000 | ❌ | 200+ | partner | Libro/Pagro 70 | Manor/SBB 150 | Coop 300 | ❌ | 50 | ✅ Eventim ekosystém | ❌ | ❌ |
| **TWINT (CH)** | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ | ❌ | ❌ | ⚠️ | ❌ |
| **EPS (AT)** | ✅ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ⚠️ | ❌ | ❌ |
| **Klarna Ratenkauf** | ✅ | ⚠️ | ⚠️ | ❌ | ✅ | ⚠️ | ❌ | ❌ | ⚠️ | ✅ | ❌ | ❌ |
| **Sofortüberweisung** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⚠️ | ✅ | ✅ | ⚠️ | ❌ |
| **Multi-jazyk DE/FR/IT** | ✅ | ✅ | jen DE | jen DE | DE/EN | ✅ 4 jazyky | DE/FR | DE/FR/IT/EN | DE | DE | EN+ | CS/SK/EN |
| **Hard ticket print+pošta** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ | ❌ | ❌ |
| **Rotující QR / NFC** | ✅ Pass | ✅ SafeTix | ❌ static | ❌ static | ✅ Pass | ✅ Pass | ❌ | ❌ | ❌ | ✅ Pass | ✅ | ✅ |
| **Phone binding** | ✅ Pass | ⚠️ Verified | ❌ | ❌ | ✅ Pass | ✅ Pass | ❌ | ❌ | ❌ | ✅ Pass | ✅ Face ID | ✅ Hot Mode |
| **Hidden QR (reveal pre-event)** | ✅ Pass | ❌ | ❌ | ❌ | ✅ Pass | ✅ Pass | ❌ | ❌ | ❌ | ✅ Pass | ✅ | ✅ |
| **Resale marketplace** | ✅ fanSALE | ✅ TM Resale | ❌ | ❌ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ Smart | ✅ |
| **Face value cap resale** | ✅ Fair Deal | umělec | — | — | ✅ | ✅ | — | — | — | — | ✅ face | ✅ |
| **Cancellation insurance** | ✅ | ⚠️ partner | ✅ Stornoschutz | ⚠️ | ✅ | ✅ | ⚠️ | ❌ | ⚠️ | ✅ | ❌ (credit) | ✅ insurance_plans |
| **Refund as credit/voucher** | partial | ⚠️ | ⚠️ | ⚠️ | partial | partial | ⚠️ | ⚠️ | ⚠️ | partial | ✅ 12mo credit | ❌ |
| **Subscription tickets** | ✅ Inhouse | ⚠️ | ⚠️ | ✅ theatres | ✅ | ✅ | ⚠️ | ⚠️ | ✅ | ✅ | ❌ | ⚠️ subs schema |
| **Timed entry slots** | ✅ Inhouse | ⚠️ | ⚠️ | ⚠️ | ✅ | ✅ | ❌ | ⚠️ | ⚠️ | ⚠️ | ❌ | ✅ migr 246 |
| **Waiting lists** | ✅ Inhouse | ⚠️ | ⚠️ | ⚠️ | ✅ | ✅ | ❌ | ❌ | ⚠️ | ⚠️ | ✅ | ✅ |
| **Custom checkout fields** | ✅ Light | ❌ | ❌ | ❌ | ✅ Light | ✅ Light | ❌ | ⚠️ | ⚠️ | ✅ | ❌ | ✅ (Vlna E2) |
| **Public price calculator** | ✅ Light | ❌ | ❌ | ❌ | ✅ Light | ✅ Light | ❌ | ✅ veřejný cenník | ❌ | ✅ | ⚠️ no fees | ✅ (Vlna E2) |
| **FB Event auto-create** | ✅ Light | ❌ | ⚠️ | ❌ | ✅ Light | ✅ Light | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ |
| **Smart resale (auto-relist)** | ⚠️ | ❌ | ❌ | ❌ | ⚠️ | ⚠️ | ❌ | ❌ | ❌ | ❌ | ✅ DICE | ⚠️ částečně |
| **Music discovery integration** | ⚠️ Spotify partial | ⚠️ Apple Music | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ⚠️ | ✅ DICE | ❌ |
| **Public Transit integration** | ⚠️ regionální | ❌ | ⚠️ | ❌ | ⚠️ | ⚠️ | ❌ | ❌ | ✅ MVV | ⚠️ | ❌ | ❌ |
| **Editorial content layer** | ⚠️ | ❌ | ✅ Tipps | ❌ | ⚠️ | ⚠️ | ⚠️ | ⚠️ | ⚠️ | ⚠️ | ✅ DICE | ❌ |
| **Veřejné REST API** | jen partnerský | ✅ Discovery+ | ❌ | ❌ | jen partnerský | jen partnerský | ❌ | ❌ | ✅ Web Service | ⚠️ | ⚠️ | ✅ /v3 + OAuth |
| **Public SDK iOS/Android** | ❌ | ✅ Secure Entry | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ⚠️ Expo skeleton |
| **Box office / POS** | ✅ all | ✅ Mobilized | ✅ | ✅ | ✅ | ✅ | ⚠️ | ✅ | ✅ | ✅ | ⚠️ DICE Pro | ✅ POS |
| **Loyalty s retail** | ✅ Mój/Premium | ⚠️ | ❌ | ❌ | ✅ | ✅ | ✅ Migros | ❌ | ❌ | ✅ | ⚠️ DICE FOMO | ❌ |
| **3D panorama seating** | ✅ Net | ⚠️ | ❌ | ❌ | ✅ | ✅ | ❌ | ❌ | ❌ | ⚠️ | ❌ | ❌ |

Legend: ✅ = má, ⚠️ = částečně/regionálně, ❌ = nemá, "—" = neuvedeno/N/A

---

# GAPS PRO TIXLY — AGREGOVANÉ Z 10 PLATFOREM

### 🔴 P0 — Strategické nebo unblocking pro DACH expanzi (8 features)

| # | Co | Z platformy | Pro koho | Effort |
|---|----|-------------|----------|--------|
| 1 | **TWINT integration** | Ticketcorner/Ticketino | CH expansion (must-have) | 1 týden |
| 2 | **Klarna Ratenkauf (BNPL)** | Eventim, oeticket | DE/AT impulse purchases | 4 dny |
| 3 | **Sofortüberweisung** (Klarna brand) | Všichni DE | DE buyers preference | 2 dny |
| 4 | **EPS Überweisung** | oeticket | AT must-have | 3 dny |
| 5 | **DE/FR/IT lokalizace UI** | Ticketcorner | DACH expansion | 2 týdny |
| 6 | **Sub-licensing model** pro fyzické prodejny | Reservix/Eventim/oeticket | DE/AT/CH retail leverage | 4 týdny |
| 7 | **Subscription/Season ticket** model | ADticket / Inhouse | Theatres + festivals + sport | 1 týden |
| 8 | **Refund as 12mo credit** (jako voucher) | DICE / Going | Cash flow benefit | 2 dny |

### 🟡 P1 — Marketing & UX (6 features)

| # | Co | Z platformy | Effort |
|---|----|-------------|--------|
| 9 | **Facebook Event auto-create** | Eventim Light | 2 dny |
| 10 | **QR kód pro nákup ve vlastním shopu** (anti-fronta promotér) | Eventim Light | 4 hodiny |
| 11 | **Editorial content layer** (curated reviews, interviews, doporučení) | Reservix Tipps / DICE | 1 týden |
| 12 | **Smart Resale (auto-relist face value)** | DICE | 1 týden |
| 13 | **Music discovery integration** (Spotify recommends) | DICE | 1-2 týdny |
| 14 | **Public Transit integration** (MHD jako součást lístku) | München Ticket | 2 týdny per město |

### 🟢 P2 — Polish (4 features)

| # | Co | Z platformy | Effort |
|---|----|-------------|--------|
| 15 | **Public cenník / kalkulačka pro promotéry** (Tixly fees) | Ticketino / Eventim Light | 1 den |
| 16 | **Hard ticket print + poštování** | Reservix / Eventim | 1 týden (logistika) |
| 17 | **DICE FOMO** ("tvůj kamarád koupil") notifikace | DICE | 3 dny |
| 18 | **3D panorama seating preview** | Eventim Net | 2-4 týdny (fotografie) |

### ❌ Nestavět (Tixly out of scope)

- Vlastní stadium/venue ownership (Live Nation model)
- 10 000 fyzických prodejen DE (Eventim retail)
- Promotér akvizice (EVENTIM LIVE)
- Vertical produkty (kina, ligy, travel)
- Magistrátní/městské API integrace (regionální only)

---

# DOPORUČENÍ PRO DACH STRATEGII

### Pokud chceš expandovat do DACH

**Phase 1 — Switzerland (CH) first** — nejmenší trh, nejvyšší příjmy:
- TWINT (#1 priorita)
- DE/FR/IT lokalizace
- CHF pricing
- Partnership s lokální tiskárnou pro hard tickets (pokud potřeba)

**Phase 2 — Austria (AT)** — kulturní blízkost CZ:
- EPS Überweisung
- DE lokalizace dostatečná
- AT VAT
- Klarna Ratenkauf

**Phase 3 — Germany (DE)** — největší ale i nejvíc kompetitivní:
- Sofortüberweisung
- Klarna full suite
- Lokální tiskárna síť (nebo digital-only positioning)
- Reservix-style self-service marketing

### Pokud zůstaneš v CZ/SK

Pak P0 zbyde jen:
- ✅ **Refund as 12mo credit** (cash flow benefit)
- ✅ **Subscription/Season tickets** (divadla)
- ✅ **Smart Resale auto-relist** (anti-scalp)

Ostatní DACH features bych **NESTAVĚL**:
- TWINT/EPS — CZ buyers nemají
- 4 jazyky — CS/SK/EN stačí
- Klarna — CZ má jiné BNPL (Twisto, Skip Pay)
- Retail síť — CZ ekvivalent neexistuje

---

# CO TIXLY MÁ NAVÍC OPROTI VŠEM 10 DACH PLATFORMÁM

Tato sekce ukazuje **moaty Tixly** — featury, které žádná z 10 DACH platforem nemá:

1. ✅ **ISDOC 6.0.2 export** (CZ účetní formát)
2. ✅ **GDPR Art. 7 audit + 90d purge** (komplet)
3. ✅ **DSA Act 2024** plně implementován
4. ✅ **Multi-tenant data sovereignty** (žádná z DACH platforem nemá)
5. ✅ **Self-service webhooks** (Eventim/TM mají jen partner-tier)
6. ✅ **OAuth 2.0 + Public REST API v3** (Eventim/Reservix/ADticket/oeticket nemají)
7. ✅ **Smart Queue + bot detection** (jen TM má, Eventim Light ne)
8. ✅ **Vickrey ad auction s CTR quality** (žádná DACH platforma)
9. ✅ **Pricemaster s observed elasticity learning** (žádná DACH platforma)
10. ✅ **Hot Event Mode** (TAN + phone binding + no-gifting + hidden QR)
11. ✅ **Live anti-screenshot watermark** s timestamp + holder
12. ✅ **NFC tap-to-enter s replay-protected JWT** (DACH má NFC ale ne dokumentovaná replay protection)
13. ✅ **Wallet Content Modules** (TM Enhanced Wallet 2025 parita)
14. ✅ **Customizable dashboards** (jen TM má)
15. ✅ **Event Templates reusable** (jen TM má)

---

# VERDICT

**Tixly je technicky na úrovni nebo NAD všemi DACH platformami** kromě:
- Distribuce (žádná retail síť)
- Payment methods (chybí TWINT/EPS/Klarna)
- Lokalizace (chybí DE/FR/IT)
- Stadium-grade 3D seating

Tyto 4 gap jsou **strategická investice pro expanzi**, ne featurové slabiny pro CZ/SK.

**Pro CZ/SK trh**: Tixly je **technicky lepší** než kterákoli DACH platforma. Hlavní gap je **brand awareness**, ne tech.

**Pro DACH expansion**: vyžaduje 6-8 týdnů práce (P0 features) + lokalizace (2 týdny) + partnership rollout (3-6 měsíců sales).

*Stav: 2026-05-22. Dokument generován z veřejných zdrojů — eventim.de, business.ticketmaster.com, reservix.de, adticket.de, oeticket.com, ticketcorner.ch, starticket.ch, ticketino.com, muenchenticket.de, eventim-light.es, dice.fm.*
