# Ticketingová platforma — výzkum & mindmapa vývoje s Claude

> Exportovaný chat · Claude Sonnet 4.6 · duben 2026

---

## 1. Zadání

Chci postavit vlastní systém na prodej vstupenek:
- vstupenky na stání, vstupenky na sezení
- vstupenky zdražující v čase
- permanentky do divadla
- všechny možné modely prodeje vstupenek
- různé moduly na marketing
- systém jako SMSTicket, GoOut, Ticketmaster, Ticketportal
- **interní tržiště** na prodej vstupenek mezi sebou — jen naše vstupenky, žádný překup, není možné prodat za vyšší ceny než se koupily (se slevou ano)

---

## 2. Výzkum — co musí ticketingový portál umět

### 2.1 Typy vstupenek (prodejní modely)

#### Stání / sezení (základní)
- Volné stání — kapacita jako číslo
- Sezení — interaktivní mapa sálu (SVG/JSON seating chart)
- Zóny s různými cenami (parter, balkón, VIP)
- Rezervace konkrétního místa s blokací v reálném čase

#### Early bird / časové zdražování (základní)
- Fáze: Early bird → Regular → Late → Door
- Automatický přechod dle data nebo prodaného množství
- Countdown timer na stránce události
- Webhook notifikace při změně fáze

#### Permanentky / předplatné (základní)
- Sezónní karta (divadlo, klub) — přístup na N akcí
- Flex pass — X vstupů z nabídky dle výběru
- Opakovaná platba (měsíční, roční — GoPay opakované platby)
- Správa benefitů: sleva na doplňky, prioritní výběr míst

#### Dynamická cena — demand-based (USP)
- Cena roste s % prodanosti (Ticketmaster Platinum model)
- Strop: pořadatel nastaví max. násobek základní ceny
- Transparentní zobrazení důvodu ceny
- Segment "spravedlivé ceny" — nenavyšovat sociálně citlivé akce

#### Bundle a skupinové vstupenky (USP)
- Rodinný balíček (2 dospělí + 2 děti = sleva X %)
- Firemní vstupenky (invoice + sídlo)
- BOGO (kup 2, získej 1 zdarma) s časovým limitem
- Kombinovat: vstupenka + ubytování / catering

#### NFT / digitální sběratelské (budoucnost)
- Vstupenka jako NFT — doklad o přítomnosti na akci
- Limitované série s uměleckým designem
- Sekundární trading: jen v rámci platformy, s cap na cenu
- Žádný technický blockchain overhead pro uživatele

---

### 2.2 Interní tržiště bez překupu — klíčové USP

**Kritická pravidla:**
- Prodej jen ověřeným účtům (telefon + e-mail + volitelně ID)
- Max. cena = cena nákupu (systém technicky zabraňuje navýšení)
- Sleva ano — prodejce může prodat i levněji
- Vstupenka se invaliduje a vydá nová (nové QR) — žádný screenshot útok
- Provize platformy: 0–5 % z transakce (motivace použít interní trh)
- Pořadatel může tržiště pro danou akci zakázat (theater mode)

**Buyer flow:**
- Browsing: filtry dle zóny, ceny, data
- Watchlist — notifikace když se vstupenka objeví
- Instant buy nebo "nabídni cenu" (jen nižší)
- Platba přes escrow — uvolní se po skenování

**Seller flow:**
- 1-click listing z "Moje vstupenky"
- Automatický návrh ceny (= původní nákupní cena)
- Expirace listingu: 24 h před akcí auto-delist
- Payout: okamžitě po vstupu kupujícího nebo po akci

**Sociální aspekty:**
- "Daruju vstupenku" — bezplatný převod (charita, přátelé)
- Reputace uživatele — hodnocení spolehlivosti prodejce
- Skupinový nákup — "mám 4 vstupenky, hledám partu"
- Event chat — komunikace bez sdílení osobních dat

---

### 2.3 Anti-scalping ochrana (4 vrstvy)

#### Vrstva 1 — ochrana při nákupu
- Anti-bot: device fingerprinting + behaviour analysis
- Queue systém s randomizací pořadí (ne FIFO)
- Purchase limit: max N vstupenek na ověřený účet / akci
- Verified Fan: pre-registrace, screening před prodejem
- Geofencing presale (CZ only na lokální akce)

#### Vrstva 2 — ochrana vstupenky
- **Dynamický QR kód** — obnovuje se každých 30 s
- Vstupenka svázána s účtem (ne s e-mailem, s identitou)
- Offline skenování s 15min sync cache (pro venkovní akce)
- NFC čip pro VIP / permanentky (wristband)

#### Vrstva 3 — ochrana u brány
- Jméno na vstupence = kontrola dokladu (pořadatel volí)
- Selfie verifikace (opt-in) — biometrické přiřazení
- Multi-scan alert: stejný QR skenován 2× = alarm
- Real-time dashboard pro pořadatele (kdo vstoupil)

#### Vrstva 4 — monitoring po prodeji
- Sledování externích trhů (Bazos, FB Marketplace) — scraping alert
- Blacklist accounts — sdílený mezi pořadateli
- Chargeback pattern detection
- Transparent audit log každé transakce

---

### 2.4 Marketing moduly

| Modul | Funkce |
|---|---|
| E-mail & SMS | Automatizované e-maily, SMS gateway (Twilio), push notifikace, segmentace |
| Referral program | Unikátní linky, odměny (sleva/cashback), multi-touch tracking, leaderboard |
| Sociální integrace | Share card, "X přátel jde", Instagram story šablona, Spotify integrace |
| CRM & Data | Plný přístup k datům, demografická analýza, heatmapa, LTV zákazníka |
| Paid Ads | Meta Pixel + CAPI, Google Ads remarketing, TikTok pixel |
| AI personalizace | Doporučení akcí, dynamic subject lines, optimal send time, churn predikce |

---

### 2.5 Tech stack

**Backend služby:**
- Event & Inventory service (real-time seat locking)
- Payment service: GoPay (primární, CZ)
- Identity & Auth: OAuth2 + MFA
- QR Engine: dynamický, time-based (TOTP-like)
- Notification service: e-mail, SMS, push
- Resale Engine: face-value enforcement

**Frontend & Mobile:**
- Web: Next.js / React — SSR pro SEO akcí
- iOS + Android: React Native nebo Flutter
- Mobilní peněženka: Apple Wallet / Google Pay pass
- Pořadatelský dashboard (real-time analytics)
- Skener app (offline-capable PWA)

**Skalabilita:**
- Queue systém (Redis / SQS) — absorpce spike trafficu
- Virtual waiting room s fair randomizací
- Database: PostgreSQL + read replicas
- CDN pro statické assety + geolokační routing

**Compliance:**
- GDPR: data residency v EU, right to erasure
- PCI DSS Level 1 (přes GoPay = out of scope)
- EET/SAF-T pro českou pokladnu
- SLA 99.9 % uptime

---

### 2.6 Roadmapa

#### MVP — Fáze 1 (0–4 měsíce)
- [ ] Prodej vstupenek (stání + sezení)
- [ ] Platební brána (GoPay)
- [ ] Dynamický QR + skener app
- [ ] Early bird / fázované zdražování
- [ ] E-mail notifikace & potvrzení

#### Růst — Fáze 2 (4–9 měsíců)
- [ ] Interní tržiště (face-value resale) ← **USP #1**
- [ ] Permanentky / předplatné
- [ ] Referral marketing modul
- [ ] Apple/Google Wallet pass
- [ ] Pořadatelský CRM + analytics

#### Diferenciace — Fáze 3 (9–18 měsíců)
- [ ] AI personalizace & doporučení ← **USP #2**
- [ ] Biometrický vstup (opt-in)
- [ ] White-label API pro pořadatele
- [ ] NFT / sběratelské vstupenky
- [ ] AR/gamifikace

#### NFC & NFT vrstva — Fáze 4 (18–24 měsíců)
*Detail: `nfc-nft-extensions.md`*
- [ ] NFC jako offline fallback credential (NTAG215, NDEF Lock Bit, HMAC podpis) — záloha pro vybitý telefon
- [ ] NFC Smart Poster → přímý nákup bez apky (NDEF URL na plakátech/výlohách, UTM atribuce)
- [ ] NFC Staff Badge autentizace — pracovníci akce, audit log, real-time revokace
- [ ] NFC Bag Check / Šatna — tag na tašce svázaný s profilem, konec papírových lístků
- [ ] NFC Seat Enhancement — objednávka jídla/merche přiložením telefonu k sedadlu
- [ ] NFC Phygital Souvenir — fyzický předmět odemkne digitální obsah / POAP
- [ ] POAP — soulbound NFT po akci (Polygon, ERC-5484), důkaz účasti z TOTP logu
- [ ] NFT kolekcionářský ticket — post-event unlock s generativní grafikou, EIP-2981 royalty
- [ ] Programmable Royalties na resale — smart contract (5 % artist / 2 % platforma / 93 % seller)
- [ ] NFT-gated presale — ověření `ownerOf()` → odemknutí presale tieru pro NFT holdery
- [ ] Event DAO hlasování — Snapshot.org, váha dle POAP série (setlist, přídavky, next ročník)
- [ ] Virtual Queue / Phantom Ticketing — Redis sorted set, časová okna nákupu, anti-crash pro výprodeje
- [ ] Parametrické pojištění — weather-triggered automatický refund (Open-Meteo webhook → refund saga)
- [ ] Accessibility Layer — wheelchair mapa tras, ZTP companion free ticket, hearing loop zóna, neurodiversity tagging
- [ ] Live Commerce — "Live Push" z dashboardu → Kafka → notification na telefony přítomných → nákup merche za akce
- [ ] eIDAS 2.0 / EU Digital Identity Wallet — age verification, anti-scalping identity, SSO pro EU (OpenID4VP)

#### Platform Evolution — Fáze 5 (24–36 měsíců)
- [ ] **Universal Subscription Economy** — měsíční paušál s kredity použitelnými cross-vertikálně (ClassPass killer)
- [ ] **Venue Marketplace** — organizátoři rezervují venue přes platformu, escrow záloha, revenue 8–12 % ← *Airbnb pro prostory*
- [ ] **Demand Aggregation** — fanoušci signalizují zájem a cenu *před* vypsáním akce, platforma agreguje pro promotéry (Songkick demand + platba)
- [ ] **Trust & Reputation Engine** — oboustranné skóre: organizer (% zrušení, refund speed) + buyer (no-show rate, chargeback), ovlivňuje prioritu listingu a presale přístup
- [ ] **AR Seat Preview** — WebXR pohled z konkrétního sedadla před koupí (3D scan venue)
- [ ] **Digital Twin Real-time** — živý 3D model venue s obsazeností a frontami pro venue management
- [ ] **Supply Chain Marketplace** — crew, technici, security, catering, equipment rental přímo v platformě ← *lock-in pro organizátory*
- [ ] **Sentiment Live** — anonymní real-time hodnocení během akce → live dashboard pro organizátora (zvuk, fronty, spokojenost)
- [ ] **Collective Action / Threshold Engine** — "pokud 10 000 fanoušků pre-registruje, artist přidá druhý koncert"; skupinové slevy se aktivací při threshold
- [ ] **Invisible Economy** — tip/gratuity pro umělce, pay-what-you-want slider, social tipping ("pošli kamarádovi drink 100 Kč")
- [ ] **Social Prescription / Wellbeing API** — integrace s NHS/pojišťovnami, "předpis" na kulturní aktivity, wellbeing skóre, Apple Health sync
- [ ] **Access Sharing Protocol** — lend (dočasný převod, vrátí se pokud neskenováno), corporate SCIM přiřazení, estate planning pro season passy
- [ ] **Demand Intelligence dashboard** — pre-sale: watchlist počty, tržní benchmark ceny, doporučená cena dle 47 srovnatelných eventů
- [ ] **Event Revenue Advance** — advance 70 % výnosu splácený z ticketových příjmů, risk model na historických datech (3–8 % fee)
- [ ] **Crowd Flow AI** — heatmapa front a bottlenecků z NFC checkpointů + WiFi probes → real-time doporučení pro venue staff
- [ ] **Federated Event Discovery** — publikace eventů na ActivityPub/Mastodon přímo z dashboardu, RSVP/nákup z Fediverse klientů

---

## 3. Mindmapa vývoje s Claude — přiřazení modelů

### Logika výběru modelu

| Model | Kdy použít |
|---|---|
| **Claude Opus 4.6** | Systémová architektura, bezpečnostní model, resale marketplace design, AI strategie — vše kde záleží na hlubokém uvažování o kompromisech |
| **Claude Sonnet 4.6** | Implementace kódu, integrace, code review, dokumentace — workhorse pro iterativní vývoj |
| **Claude Haiku 4.5** | Testy, seed data, e-mailové šablony, SQL migrace, changelogy, překlady — rutinní, objemové, rychlé úkoly |

---

### Fáze 0 — Příprava a architektura

#### Opus 4.6
```
Navrhni systémovou architekturu ticketingové platformy — microservices,
databázové schéma, API design
```
> Návrh microservices, ERD, API kontrakt, volba tech stacku, trade-off analýza

```
Navrhni bezpečnostní model ticketingové platformy — anti-scalping,
dynamický QR, identity vrstva
```
> Anti-scalping strategie, threat modeling, identity & auth flows, GDPR compliance

#### Sonnet 4.6
```
Vygeneruj OpenAPI 3.0 specifikaci pro tickets endpoint — CRUD, resale, scanning
```

```
Vytvoř databázové schéma pro ticketingovou platformu v PostgreSQL
— events, tickets, users, resale
```

#### Haiku 4.5
```
Vygeneruj boilerplate strukturu Next.js projektu pro ticketingovou platformu
```

---

### Fáze 1 — MVP: Prodej vstupenek + platby + QR vstup

#### Sonnet 4.6
```
Napiš TypeScript implementaci GoPay integrace pro prodej vstupenek
s webhooky — platba kartou, bankovní převod, opakované platby
```
> GoPay checkout, webhooky, refund flow, idempotency klíče

```
Implementuj dynamický QR kód pro vstupenky — TOTP-based,
obnovování každých 30 sekund, offline scanning
```
> TOTP-like generátor, offline cache, multi-scan detekce, scanner PWA

```
Napiš React komponentu pro interaktivní mapu sálu — SVG seating chart
s výběrem míst a blokací
```
> Interaktivní mapa, real-time blokace míst, zóny a ceny

```
Implementuj fázové zdražování vstupenek — early bird, regular, late, door
— s automatickým přechodem
```
> Fáze, časové triggery, demand-based dynamika, audit log

#### Haiku 4.5
```
Vygeneruj unit testy pro pricing engine — edge cases, phase transitions,
concurrent purchases
```

```
Napiš e-mailové šablony pro ticketingovou platformu — potvrzení objednávky,
vstupenka, reminder 48h
```

```
Vygeneruj seed data pro ticketingovou platformu — 10 akcí, 500 uživatelů,
různé typy vstupenek
```

---

### Fáze 2 — Tržiště bez překupu + permanentky

#### Opus 4.6
```
Navrhni technickou architekturu face-value resale marketplace — escrow platby,
invalidace QR, price cap enforcement
```
> Escrow flow, price cap enforcement na DB úrovni, invalidace starého QR a vydání nového, seller/buyer matching, edge cases (no-show, fraud)

#### Sonnet 4.6
```
Implementuj resale listing API — POST /resale, price validation,
escrow hold, buyer notification
```

```
Implementuj systém permanentek pro divadlo — sezónní karta, flex pass,
opakovaná platba přes GoPay opakované platby
```

```
Implementuj Apple Wallet a Google Pay pass pro vstupenky
— PKPass generátor, push update při změně QR
```

#### Haiku 4.5
```
Napiš automated testy pro resale flow — price cap bypass pokusy,
double-scan, expired listing
```

```
Generuj SQL reporty pro pořadatele — prodeje dle zóny,
resale objem, demografika kupujících
```

---

### Fáze 3 — Marketing moduly + AI personalizace

#### Opus 4.6
```
Navrhni AI personalizační engine pro ticketingovou platformu — doporučení akcí,
predikce churn u permanentek, optimal send time
```
> Recommendation engine design, feature engineering, churn predikce, A/B testovací framework

#### Sonnet 4.6
```
Implementuj referral marketing systém — unikátní linky, tracking multi-touch,
cashback odměny, leaderboard
```

```
Implementuj Meta Conversions API a TikTok Pixel pro ticketingovou platformu
— server-side eventy
```

#### Haiku 4.5
```
Napiš 10 variant subject lines pro e-mail kampaně — last-minute vstupenky,
early bird expiruje, skupina přátel
```

```
Generuj push notifikace texty pro ticketingovou platformu — reminder,
resale alert, early bird expiruje
```

---

### Průřezové úkoly — celý vývoj

#### Sonnet 4.6
```
Proveď code review tohoto kódu ticketingové platformy se zaměřením
na bezpečnost a performance
```

```
Napiš technickou dokumentaci pro ticketingové API
— developer onboarding guide, webhook reference
```

#### Haiku 4.5
```
Vygeneruj changelog a release notes pro ticketingovou platformu verze 1.0
```

```
Přelož UI texty ticketingové platformy do angličtiny a němčiny
— zachovej tón a délku
```

```
Vygeneruj SQL migrace pro ticketingovou platformu
— přidej tabulku resale_listings s RLS polítikami
```

---

## 4. Co zařídit před vývojem

Pořadí je důležité — GoPay schvalování trvá nejdéle, proto jako první.

- [ ] **Firma / živnost** — IČO, bankovní účet (Fio, Revolut Business)
- [ ] **GoPay účet** — gopay.com, vyžaduje IČO + výpis z účtu, schválení 3–7 dní
- [ ] **Doména** — .cz + .com (Wedos nebo Cloudflare Registrar)
- [ ] **Cloudflare** — přidej doménu ihned po koupi, zdarma plán stačí (CDN, DDoS ochrana, SSL, DNS)
- [ ] **Firemní e-mail** — Google Workspace nebo Zoho
- [ ] Hosting, servery, CI/CD — řeš až máš MVP co nasadit (Vercel + Supabase zdarma)

---

## 5. Doporučené Claude nástroje

- **Claude Code** (terminál) — pro dlouhé kódovací sessiony, spouštění testů, opravy a commit
- **Claude Code for VS Code** — integrace přímo v editoru

---

*Vygenerováno Claude Sonnet 4.6 · claude.ai*
