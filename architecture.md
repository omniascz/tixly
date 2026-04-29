# Systémová architektura — Tixly

> Claude Opus 4.6 · 4.4.2026

---

## 1. Přehled microservices

Celkem 11 doménových služeb + 3 infrastrukturní. Hranice vedeny podle bounded contexts (DDD).

### Doménové služby

| Služba | Odpovědnost | Proč samostatná |
|---|---|---|
| **Event Service** | CRUD akcí, SVG mapy sálů, kapacity, fázové ceníky, plánování zveřejnění | Vlastní doménový model akce. Mapa sálu je komplexní subdoména (SVG parsing, seat locking). |
| **Pricing Engine** | Výpočet aktuální ceny: fázové zdražování, demand-based dynamika, bundle slevy, promo kódy | Cenová logika se mění nezávisle na zbytku. Demand-based pricing potřebuje vlastní read model z prodejních dat. |
| **Order Service** | Nákupní flow: košík → rezervace → platba → potvrzení. Orchestrátor celé transakce. Saga pattern. | Musí garantovat konzistenci mezi seat lockem, platbou a vydáním vstupenky. |
| **Ticket Service** | Životní cyklus vstupenky: vydání, dynamický QR (TOTP), invalidace, převod na resale. Generuje PDF/Wallet pass. | QR rotace (TOTP) je bezpečnostně citlivá logika — izolace snižuje attack surface. |
| **Resale Marketplace** | Listing vstupenky k prodeji (≤ původní cena), matching buyer–seller, escrow, trigger nového QR po převodu | Oddělená doména s vlastními pravidly (cenový cap, escrow stav). Jiný životní cyklus než Order Service. |
| **Payment Service** | Abstrakce nad GoPay (primární), případně Stripe (budoucnost). Escrow pro resale. Refundy. | PCI DSS boundary — veškerá komunikace s platební bránou prochází jen touto službou. |
| **User & Identity Service** | Registrace, login (e-mail + social), JWT vydávání, GDPR operace (export, výmaz), device fingerprinting | Identity je cross-cutting, ale musí být samostatná kvůli bezpečnosti a GDPR compliance. |
| **Anti-Scalping Service** | 4-vrstvý systém: rate limiting nákupu, ticket binding, gate validation, monitoring anomálií | Samostatná kvůli real-time rozhodování. Konzumuje eventy z ostatních služeb a vyhodnocuje vzorce. |
| **Gate / Check-in Service** | Validace QR při vstupu, offline-first design (lokální cache), counting vstupů | Musí fungovat i při výpadku sítě. Vlastní lokální DB se synchronizací. |
| **Marketing & CRM Service** | E-mail/SMS kampaně (Mailgun/Twilio), referral program, Meta/TikTok pixel events, segmentace | Oddělená — marketing má vlastní tempo vývoje a jiné SLA než core ticketing. |
| **AI / Recommendation Service** | Doporučení akcí, churn predikce permanentek, optimal send time pro kampaně | ML modely běží asynchronně, trénují se na historických datech. Nesmí blokovat hlavní flow. |

### Infrastrukturní služby

| Služba | Účel |
|---|---|
| **API Gateway** | Rate limiting, autentizace (JWT validace), routing, request logging. Next.js BFF pro web frontend. |
| **Event Bus (Kafka)** | Asynchronní komunikace mezi službami. |
| **Notification Dispatcher** | Centrální odesílání e-mailů, SMS, push notifikací — konzumuje eventy, deduplikuje. |

---

## 2. Konceptuální datový model (ERD)

```
┌─────────────┐       ┌──────────────────┐       ┌─────────────────┐
│    USER      │       │      EVENT       │       │     VENUE       │
├─────────────┤       ├──────────────────┤       ├─────────────────┤
│ id (PK)     │       │ id (PK)          │       │ id (PK)         │
│ email       │       │ organizer_id(FK) │──┐    │ name            │
│ phone       │       │ venue_id (FK)    │──┼──▶ │ address         │
│ name        │       │ title            │  │    │ seat_map_svg    │
│ device_fp   │       │ date_start/end   │  │    │ capacity        │
│ gdpr_consent│       │ status           │  │    └─────────────────┘
│ created_at  │       │ category         │  │
└──────┬──────┘       └────────┬─────────┘  │
       │                       │            │
       │                       ▼            │
       │              ┌──────────────────┐  │    ┌─────────────────┐
       │              │  TICKET_TYPE     │  │    │  PRICING_RULE   │
       │              ├──────────────────┤  │    ├─────────────────┤
       │              │ id (PK)          │  │    │ id (PK)         │
       │              │ event_id (FK)    │  │    │ ticket_type_id  │
       │              │ kind (enum)      │  │    │ phase           │
       │              │  [standing|      │  │    │ threshold_qty   │
       │              │   seated|        │  │    │ threshold_date  │
       │              │   season_pass|   │  │    │ price           │
       │              │   bundle]        │  │    │ demand_factor   │
       │              │ base_price       │  │    │ min/max_price   │
       │              │ total_qty        │  │    └─────────────────┘
       │              │ remaining_qty    │  │
       │              │ max_per_user     │  │
       │              └────────┬─────────┘  │
       │                       │            │
       ▼                       ▼            │
┌──────────────┐      ┌──────────────────┐  │
│    ORDER     │      │     TICKET       │  │
├──────────────┤      ├──────────────────┤  │
│ id (PK)      │◀────▶│ id (PK/UUID)     │  │
│ user_id (FK) │      │ order_id (FK)    │  │
│ status       │      │ ticket_type_id   │  │
│ total_amount │      │ owner_id (FK)    │──┘
│ gopay_tx_id  │      │ seat_id (FK)?    │
│ expires_at   │      │ status           │
│ created_at   │      │ totp_secret      │
└──────────────┘      │ original_price   │
                      │ bound_to_user_id │
                      │ transfer_count   │
                      └────────┬─────────┘
                               │
                      ┌────────▼─────────┐
                      │  RESALE_LISTING  │
                      ├──────────────────┤
                      │ id (PK)          │
                      │ ticket_id (FK)   │
                      │ seller_id (FK)   │
                      │ buyer_id (FK)?   │
                      │ ask_price        │
                      │  (≤ orig_price)  │
                      │ escrow_status    │
                      │ status           │
                      └──────────────────┘

Další entity: SEASON_PASS, REFERRAL, CAMPAIGN, AUDIT_LOG
```

### Klíčová rozhodnutí v datovém modelu

- **`totp_secret` na TICKET**: Každá vstupenka má vlastní TOTP seed. Při resale se generuje nový secret → starý QR je okamžitě neplatný.
- **`bound_to_user_id`**: Pevná vazba vstupenka–uživatel pro anti-scalping.
- **`demand_factor` v PRICING_RULE**: Koeficient 0.8–1.5 přepočítávaný každých 5 minut z velocity prodejů.
- **`max_per_user` na TICKET_TYPE**: Tvrdý limit proti hromadným nákupům.

---

## 3. API design — komunikační vzory

### Synchronní (REST) — jen tam, kde klient čeká na odpověď

Saga orchestrátor v Order Service:
1. Reserve seats (Ticket Service) — sync, timeout 2 s
2. Calculate price (Pricing Engine) — sync, timeout 1 s
3. Create payment (Payment Service → GoPay) — sync, timeout 10 s
4. On success: Confirm tickets → emit `OrderCompleted` event
5. On failure: Compensate (release seats, cancel payment) — idempotentní

### Asynchronní (Event-driven, Kafka)

| Event | Producer | Consumer(y) |
|---|---|---|
| `OrderCompleted` | Order Service | Ticket Service, Marketing, AI, Anti-Scalping |
| `TicketListedForResale` | Resale Marketplace | Anti-Scalping, Notification |
| `ResalePurchaseCompleted` | Resale Marketplace | Ticket Service (nový TOTP), Payment (release escrow) |
| `TicketScannedAtGate` | Gate Service | Anti-Scalping, Event Service |
| `SuspiciousActivityDetected` | Anti-Scalping | User Service, Notification |

**Proč Kafka:** Event replay (audit, AI trénink), ordering guarantees per partition, retention pro historická data.

### API Gateway
- **BFF pattern**: Next.js API routes jako Backend-for-Frontend
- **GraphQL** pro frontend (čtení) — klient si řekne o přesná data
- **REST** pro inter-service komunikaci
- **gRPC** zvážit až při škálování

---

## 4. Klíčové trade-off rozhodnutí

### Saga orchestrátor vs. choreografie
**Zvoleno: Orchestrátor** — explicitní flow, snazší debugging, centrální retry/compensation logika.

### Seat locking strategie
**Zvoleno: Optimistický lock s TTL (Redis, 7 minut)**
- `SETNX seat:{id} → order:{id}, TTL 420s`
- Proč ne pesimistický DB lock: při 10 000 concurrent users → deadlocky a connection pool exhaustion v PostgreSQL.
- Proč 7 min: 90 % úspěšných nákupů proběhne do 4 minut. 7 min je buffer.

### Dynamické ceny
**Zvoleno: Transparentní dynamika s guardrails**
- `min_price` a `max_price` na PRICING_RULE — organizátor nastaví strop
- Uživatel vidí "cena se mění podle poptávky" + historii cen
- Transparentnost buduje důvěru oproti Ticketmaster

### Monolith DB vs. DB-per-service
**Zvoleno: Hybridní — sdílený PostgreSQL cluster, separátní schémata**
- Cross-service joiny zakázané — komunikace přes API/eventy
- Migrace na oddělené DB instance až při potřebě jiného engine nebo jiného scaling

### Modulární monolith na startu
**Začít jako monolith s modulární strukturou, rozsekat na microservices "až když bolí"** — tým 5–15 lidí nemá kapacitu spravovat 11 separátních deployment pipelines od začátku.

---

## 5. Skalabilita — spike traffic strategie

### Virtual Waiting Room
```
Uživatel přijde → Redis sorted set (score = timestamp)
→ Frontend zobrazí pozici v pořadí
→ Backend zpracovává dávky (500 users/min)
→ Při řadě → time-limited purchase token (5 min)
```
FIFO fronta — transparentnější než Ticketmaster (náhodný výběr).

### Auto-scaling triggers

| Metrika | Trigger | Akce |
|---|---|---|
| Request rate > 10k/s | Scale out Order Service | +5 instancí |
| Redis memory > 70% | Scale out Redis cluster | Add shard |
| DB connection pool > 80% | Switch to read replicas | Route reads to replicas |
| Kafka consumer lag > 10k | Scale out consumers | +3 consumer instances |

### Pre-warming
30 minut před plánovaným prodejem: scale Order Service, pre-populate Redis, warm CDN cache.

---

## 6. Celkový diagram

```
                    ┌──────────────┐
                    │   CDN        │
                    │ (Cloudflare) │
                    └──────┬───────┘
                           │
                    ┌──────▼───────┐
          ┌─────── │  API Gateway  │ ────────┐
          │        │  + Waiting    │         │
          │        │    Room       │         │
          │        └──────┬───────┘          │
          │               │                  │
    ┌─────▼─────┐  ┌──────▼──────┐  ┌───────▼───────┐
    │  Next.js  │  │   Order     │  │   Resale      │
    │  BFF/SSR  │  │   Service   │  │   Marketplace │
    └───────────┘  │  (Saga)     │  └───────┬───────┘
                   └──┬───┬──┬──┘          │
                      │   │  │             │
          ┌───────────┘   │  └──────┐      │
          ▼               ▼         ▼      ▼
    ┌──────────┐  ┌──────────┐ ┌────────────────┐
    │ Pricing  │  │ Ticket   │ │ Payment        │
    │ Engine   │  │ (TOTP QR)│ │ (GoPay+Escrow) │
    └──────────┘  └──────────┘ └────────────────┘
                       │
                  ┌────▼─────┐
                  │  Gate /  │
                  │ Check-in │
                  │ (offline)│
                  └──────────┘

    Cross-cutting (event-driven via Kafka):
    ┌──────────────┐ ┌───────────┐ ┌────────────┐
    │ Anti-Scalping│ │ Marketing │ │ AI/Reco    │
    │ Service      │ │ & CRM     │ │ Service    │
    └──────────────┘ └───────────┘ └────────────┘

    Data stores:
    ┌──────────┐  ┌───────┐  ┌───────┐  ┌──────────┐
    │PostgreSQL│  │ Redis │  │ Kafka │  │ClickHouse│
    │(primary) │  │Cluster│  │       │  │(analytics│
    └──────────┘  └───────┘  └───────┘  └──────────┘
```

---

## 7. Pragmatická fázovost

| Fáze | Měsíce | Obsah |
|---|---|---|
| MVP | 1–4 | Event, Order, Ticket (statický QR), Payment, User. Monolith. |
| Fáze 2 | 5–7 | Dynamický TOTP QR, Anti-Scalping vrstva 1+2, seat map, fázové ceny |
| Fáze 3 | 8–10 | Resale Marketplace, escrow, Pricing Engine (demand-based), Marketing |
| Fáze 4 | 11+ | AI personalizace, full anti-scalping, virtual waiting room |
