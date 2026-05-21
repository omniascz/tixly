# Ticketmaster Parity Roadmap

**Cíl:** Dohnat Ticketmaster feature-by-feature. Plný TM playbook adoptován pro CZ/SK trh (s EU compliance overlay — žádný dynamic surge).

**Aktuální stav:** Tixly skóre ≈ 35 % TM parity (z paritní analýzy 2026-05-21).
**Cílový stav:** ≥ 85 % TM parity za 3-4 měsíce.

---

## Strategický rámec

### Co kopírujeme 1:1
- Smart Queue (virtuální fronta s pozicí + anti-bot)
- Verified Fan (registrace + ML scoring + selection)
- Event Groups + Bulk Edit + Coordinated Onsale (multi-tour tooling)
- Native mobile app (iOS + Android)
- Rotating barcode (server-side, anti-screenshot)
- NFC tap-and-go
- Apple Wallet Enhanced (content modules)
- Pricemaster-style tool (tier review, NE dynamic surge)
- Promoted Ads retail media network
- Real-time TM1 Sales dashboard
- Top Picks (recommendation engine)
- All In Pricing (FTC compliance)
- Reimbursement Method (refund holdback card)
- Discovery Feed (bulk JSON + CSV)
- Compare price requests
- Mobilized Box Office native app
- Chain of custody (částečně máme)
- Face Value Exchange resale

### Co vědomě NEdoženeme
- **Dynamic / surge pricing** — EU regulační riziko (price gouging fines)
- **Platinum** sebepojmenování — eticky pochybné (stejné sedadlo, vyšší cena)
- **Box office hardware partnerships** — CapEx-heavy, ne software hra
- **Enterprise sales team** — TM má 30 let kontaktů

### Naše unique moaty (zachovat)
- ISDOC XML export (Pohoda/Money S3/Helios)
- Multi-tenant data sovereignty (vs aggregator model)
- GDPR Art. 7 audit + 90d purge
- DSA Act 2024 queue + AI moderation
- Self-service webhooks + embed widget
- Custom seating editor (vs templates)

---

## Roadmap — 6 fází × 12-16 týdnů

### 📍 Fáze 1: Quick wins (2 týdny) — schémata existují

| # | Feature | Effort | Stav schémátu |
|---|---|---|---|
| 1.1 | **Smart Queue** logika (anti-bot, real-time pozice, telefonní validace) | 3-4 dny | ✅ `queue_enabled`, `queue_max_concurrent` |
| 1.2 | **Verified Fan** registrace + ML scoring + selection | 4-5 dní | ✅ `verified_fan_*` columns |
| 1.3 | **All In Pricing** transparency (vč. fees v ceně) | 1 den | ✅ checkout existuje |
| 1.4 | **Reimbursement Method** (karta pro refund holdback) | 1-2 dny | ❌ migrace nutná |
| 1.5 | **Discovery Feed** bulk export (JSON + CSV, hourly refresh) | 2 dny | ❌ |
| 1.6 | **Face Value Exchange** mode v resale | 1 den | ✅ resale schema |
| 1.7 | **Chain of custody** vizualizace v promoter admin | 1 den | ✅ ticket_transfer_log |
| 1.8 | **Top Picks** simple recommendation (algoritmus) | 2 dny | ✅ catalog.event_seats |

**Celkový effort Fáze 1: ~15 dní (3 týdny)**
**Výsledek:** TM parity skóre 35 % → 60 %

### 📍 Fáze 2: Multi-event tooling (2-3 týdny)

| # | Feature | Effort |
|---|---|---|
| 2.1 | **Event Groups** (tour, festival, opakované série) | 3 dny |
| 2.2 | **Bulk Edit** napříč events | 2-3 dny |
| 2.3 | **Coordinated Onsale** (synchronized start) | 2 dny |
| 2.4 | **Cross-Org Event Group Sharing** (tour delegace) | 3-4 dny |
| 2.5 | **Reusable templates** (rozšířit existující) | 1 den |
| 2.6 | **Attraction & Artist Management** (sdílený artist napříč events) | 3 dny |

**Celkový effort Fáze 2: ~15 dní (3 týdny)**
**Výsledek:** 60 % → 70 %

### 📍 Fáze 3: Real-time + analytics (2 týdny)

| # | Feature | Effort |
|---|---|---|
| 3.1 | **Real-time TM1 Sales dashboard** (SSE/WebSocket live revenue) | 3-4 dny |
| 3.2 | **Compare price requests** (cenové scénáře porovnání) | 2 dny |
| 3.3 | **Promoted Ads retail media** (cross-promotion napříč promotéry) | 4-5 dní |
| 3.4 | **Customizable dashboards** rozšíření | 1 den |
| 3.5 | **Scan log export upgrade** (více polí, multi-event) | 1-2 dny |
| 3.6 | **Mobilized Box Office** rozšíření (upgrade sedadla, last-minute) | 2 dny |

**Celkový effort Fáze 3: ~13 dní (2.5 týdne)**
**Výsledek:** 70 % → 78 %

### 📍 Fáze 4: Native mobile app (6-8 týdnů)

| # | Feature | Effort |
|---|---|---|
| 4.1 | **React Native + Expo POC** | 1 týden |
| 4.2 | **Buyer app** — discovery, checkout, my tickets, push | 2-3 týdny |
| 4.3 | **Scanner app** — native QR/NFC scanner, offline-first SQLite | 1-2 týdny |
| 4.4 | **Mobilized Box Office app** (sales na mobilu) | 1 týden |
| 4.5 | **Apple/Google Wallet** native integration | 3 dny |
| 4.6 | **Push notifications** (FCM + APNs) | 2 dny |
| 4.7 | **App Store + Google Play submission** | 1 týden review |

**Celkový effort Fáze 4: 7-8 týdnů**
**Výsledek:** 78 % → 85 %

### 📍 Fáze 5: SafeTix-grade security (4 týdny)

| # | Feature | Effort |
|---|---|---|
| 5.1 | **Server-side rotating barcode** (5-15s rotation, TOTP-style) | 1 týden |
| 5.2 | **Screenshot blockade** (FLAG_SECURE iOS/Android v native app) | 2 dny |
| 5.3 | **Animované prvky** (anti-fraud vizuální) | 3 dny |
| 5.4 | **NFC tap-and-go** (native app + venue NFC readers spec) | 1-2 týdny |
| 5.5 | **Enhanced Wallet** (content modules: Apple Music, weather, maps) | 3-4 dny |
| 5.6 | **Branding artist na vstupence** | 2 dny |

**Celkový effort Fáze 5: 4 týdny**
**Výsledek:** 85 % → 92 %

### 📍 Fáze 6: Pricing engine + Promoted Ads (3-4 týdny)

| # | Feature | Effort |
|---|---|---|
| 6.1 | **Tier pricing engine** (early bird → standard → late, NE surge) | 1 týden |
| 6.2 | **Compare price scenarios tool** v adminu | 3-4 dny |
| 6.3 | **Pricemaster-style** dashboard (tier review, ne automatic repricing) | 1 týden |
| 6.4 | **Promoted Ads retail media network** full (cross-promo bidding) | 1-2 týdny |
| 6.5 | **In-Demand placeholder** (vyšší cena bez surge label) | 2 dny |

**Celkový effort Fáze 6: 3-4 týdny**
**Výsledek:** 92 % → 95 % (zbytek je enterprise-tier co Tixly úmyslně skipuje)

---

## Časový harmonogram

```
Týden  1-3   ┃ Fáze 1 — Smart Queue, Verified Fan, All-In, Reimbursement, Discovery, Face Value, Chain custody, Top Picks
Týden  4-6   ┃ Fáze 2 — Event Groups, Bulk Edit, Coordinated Onsale, Cross-Org Sharing, Artist Mgmt
Týden  7-9   ┃ Fáze 3 — Real-time TM1 Sales, Compare Pricing, Promoted Ads, Scan Log Upgrade
Týden 10-17  ┃ Fáze 4 — Native mobile app (8 týdnů)
Týden 18-21  ┃ Fáze 5 — SafeTix-grade (rotating barcode, NFC, Enhanced Wallet)
Týden 22-25  ┃ Fáze 6 — Pricing engine, Promoted Ads full, Pricemaster-style

CELKEM: 25 týdnů = 6 měsíců FT (1 dev)
        Při 2 devs paralelně: 12-15 týdnů (3.5 měsíce)
```

---

## Akční plán — TENTO TÝDEN

### Začínáme Fází 1 hned:

**Den 1-2:** Smart Queue
- Migrace 289: queue tokens schema + position tracking
- `/api/queue/[eventId]/join` endpoint
- `/api/queue/[eventId]/status/[token]` endpoint
- Anti-bot: telefonní validace (SMS přes BulkGate)
- UI komponenta s real-time pozice update

**Den 3-4:** Verified Fan
- Migrace 290: verified_fan_registrations + scoring
- `/api/verified-fan/register` endpoint
- `/api/platform/verified-fan/select` (master admin selection)
- Cron: po deadline → select N% fanoušků → poslat access kódy
- UI: fanoušek se registruje 7 dní před onsale

**Den 5:** All-In Pricing + Top Picks + Discovery Feed
- All-In: refactor checkout aby fees byly v ceně už při display
- Top Picks: SQL view `vw_top_picks` (best available per zone)
- Discovery Feed: `/api/v1/feed/events.json` + `.csv`

**Den 6-7:** Reimbursement Method + Face Value Exchange + Chain of Custody UI
- Migrace 291: reimbursement_methods schema
- Reimbursement: tokenized debit card (Stripe.js / GoPay tokenization)
- Face Value Exchange: nový mode v resale_listings
- Chain of custody: visualization v `/admin/events/[id]/ticket-history`

---

## Stav po každé fázi

| Po fázi | Score | Use-case |
|---|---|---|
| Start | 35 % | Local CZ/SK launch ready, ne enterprise |
| Po F1 (3w) | 60 % | Velké koncerty + festivaly OK (Smart Queue, Verified Fan) |
| Po F2 (6w) | 70 % | Multi-tour management (Springsteen tour-level) |
| Po F3 (8.5w) | 78 % | Enterprise dashboard parity |
| Po F4 (16.5w) | 85 % | Native app launch — fan acquisition |
| Po F5 (20.5w) | 92 % | SafeTix-grade anti-fraud (rotating barcode + NFC) |
| Po F6 (25w) | 95 % | Full TM parity, ready for international expansion |

---

## Rizika

### Tech rizika
- **Native app review** (Apple/Google) může trvat 1-3 týdny
- **NFC hardware** ve venue partnership nutná (existing infrastructure)
- **Rotating barcode** vyžaduje serverovou latency < 100ms (Redis distributed cache)
- **Real-time dashboard** SSE/WebSocket scaling (Vercel Edge functions limit)

### Business rizika
- **Enterprise sales** TM má 30-letý relationship moat
- **Brand recognition** — fani jdou na TM ne na Tixly
- **Anti-bot war** TM utratil $100M+ R&D — Smart Queue obejít jde

### Compliance rizika
- **EU dynamic pricing** ban (DMA, Consumer Rights Directive) — proto Pricemaster bez surge
- **DSA Act fines** za podvodné listings → AI moderation MUST stay
- **PSD2 SCA** strong customer authentication (3DS2) — GoPay drží

---

## Co AUDIT nepokrývá

- **Mobile app code (4.1-4.7)** — vyžaduje separate React Native repo (mimo nextjs-boilerplate)
- **NFC venue hardware spec** — partnership s POS vendor (CCV, Sumup, ...)
- **Apple Wallet PassType cert** — Apple Developer enrollment ($99/rok)
- **Google Wallet service account** — Google Pay & Wallet API review

---

## Audit log

| Datum | Verze | Změny |
|---|---|---|
| 2026-05-21 | v1 | první roadmap, 6 fází, 25 týdnů, 35→95% TM parity |
