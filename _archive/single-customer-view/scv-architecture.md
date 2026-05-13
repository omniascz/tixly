# Single Customer View (SCV) a Fan Data Platform — Tixly

## Architektonický dokument — Task #77

**Verze:** 1.0 | **Datum:** 2026-04-06 | **Autor:** Claude Opus (Sonnet 4.6) | **Status:** Finální návrh pro task #78

---

## Obsah

1. Přehled architektury a klíčová rozhodnutí
2. Single Customer View — datový model
3. LTV model (Customer Lifetime Value)
4. Fan segmenty a personalizace
5. Data governance — multi-promotér kontext
6. Fan identity resolution
7. Data freshness a pipeline architektura
8. Analytics a reporting
9. DB schéma — SQL CREATE TABLE
10. TypeScript interface definice
11. Kafka event schéma
12. Architekturální diagramy
13. Trade-off rozhodnutí
14. Implementační plán pro task #78

---

## 1. Přehled architektury a klíčová rozhodnutí

### Pozice SCV v systému

SCV je **platform-level read model** — existuje vně jednotlivých service schémat (`orders`, `catalog`, `loyalty`, `passes`, `resale`, `segmentation`) a agreguje data z nich do jednotného fan profilu. SCV **nikdy nepíše** do source-of-truth schémat; je to čistý derivát.

```
┌─────────────────────────────────────────────────────────────────────┐
│                    TIXLY PLATFORM                             │
│                                                                     │
│  SOURCE-OF-TRUTH SERVICES (write side)                             │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌─────────┐  │
│  │ identity │ │  orders  │ │ loyalty  │ │  passes  │ │ resale  │  │
│  │  users   │ │  orders  │ │ accounts │ │ season_  │ │listings │  │
│  │          │ │  items   │ │  ledger  │ │ passes   │ │         │  │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬────┘  │
│       │            │            │             │            │        │
│  ─────────────────── KAFKA TOPICS ──────────────────────────────   │
│       │            │            │             │            │        │
│  ┌────▼────────────▼────────────▼─────────────▼────────────▼────┐  │
│  │           SCV CONSUMER (fan.kafka_consumer)                   │  │
│  │        Konzumuje eventy, updatuje fan schéma                  │  │
│  └───────────────────────────┬───────────────────────────────────┘  │
│                              │                                      │
│  ┌───────────────────────────▼───────────────────────────────────┐  │
│  │                  SCHÉMA: fan  (READ MODEL)                    │  │
│  │  profiles │ event_history │ ltv_scores │ segments             │  │
│  │  segment_memberships │ preference_vectors │ identity_graph    │  │
│  └───────────────────────────┬───────────────────────────────────┘  │
│                              │                                      │
│  ┌───────────────────────────▼───────────────────────────────────┐  │
│  │               CONSUMER SERVICES                               │  │
│  │  recommendation-engine │ churn-prediction │ audience-         │  │
│  │  segmentation │ optimal-send-time │ server-side-tracking     │  │
│  └───────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

### Klíčové architekturální volby

| Rozhodnutí | Volba | Zdůvodnění |
|---|---|---|
| Read model pattern | CQRS — oddělený fan read model | Source-of-truth schémata jsou nezávislá; read model může být denormalizovaný bez dopadu na transakce |
| Agregační mechanismus | Kafka events primárně + denní batch pro catch-up | Real-time freshness pro kritická data, batch pro skóre |
| Schéma | Nové schéma `fan` | Žádná cross-schema FK, izolace zodpovědností, jednoduché RLS |
| Freshness pro profil | Kafka: <5 sekund, batch skóre: denní | Profile data musí být aktuální; LTV a churn skóre jsou dost čerstvé i denně |
| Multi-promotér | RLS + dedikovaná vrstva API pro promotér-viditelná data | Promotér nesmí vidět platform-level data jiných promotérů |
| Identity resolution | Deterministický matching primárně, probabilistický sekundárně | Tixly má BankID — to je groundtruth; probabilistický matching jen pro starší neověřené profily |

---

## 2. Single Customer View — datový model

### Co SCV agreguje

Fan profil je centralizovaný **read model** skládající se z:

```
fan.profiles (core identity + agregované metriky)
       │
       ├── fan.event_history      (konkrétní zakoupené/navštívené eventy)
       ├── fan.ltv_scores         (LTV skóre s historií, segmenty)
       ├── fan.segments           (definice dynamických segmentů)
       ├── fan.segment_memberships (přiřazení fanů do segmentů)
       ├── fan.preference_vectors (vektory pro recommendation engine)
       ├── fan.identity_graph     (propojení více účtů/emailů)
       ├── fan.communication_prefs (email/SMS/push opt-in, send time)
       └── fan.promoter_views     (co konkrétní promotér smí vidět)
```

### CQRS: Write model vs. Read model

**Write model** = zdrojové schémata (`identity`, `orders`, `loyalty`, `passes`, `resale`). Sem se zapisují transakce. SCV z nich čte přes Kafka.

**Read model** = `fan` schéma. Sem SCV consumer zapisuje agregovaný pohled. API routes pro SCV čtou výhradně z `fan` schématu.

Výhoda: read dotazy pro promotér dashboard jsou jednoduché `SELECT` z jedné tabulky bez komplexních JOIN přes 5 schémat.

### Data freshness záruky

| Kategorie dat | Freshness SLA | Mechanismus |
|---|---|---|
| Jméno, email, telefon | < 30 sekund | Kafka `identity.user_updated` |
| Loyalty balance, tier | < 10 sekund | Kafka `loyalty.points_earned` |
| Nová objednávka | < 15 sekund | Kafka `order.completed` |
| Churn score | < 24 hodin | Batch job denně 06:00 (shoduje se s existujícím) |
| LTV score | < 24 hodin | Batch job denně 07:00 |
| RFM segment | < 1 hodina | Cron job každou hodinu |
| Preference vector | < 6 hodin | Batch job každých 6 hodin |
| Send time | < 24 hodin | Existující batch job 04:00 |

---

## 3. LTV model (Customer Lifetime Value)

### Komponenty LTV

```
LTV = AOV × PurchaseFrequency × PredictedLifespanYears × (1 - ChurnProbability)

kde:
  AOV                = průměrná hodnota objednávky v haléřích (INTEGER)
  PurchaseFrequency  = počet objednávek za rok
  PredictedLifespan  = 1 / ChurnRate (v letech), capped na 5 let
  ChurnProbability   = z existujícího churn-prediction modulu
```

### Výpočet

```
// Základní LTV (historická)
historical_ltv = SUM(paid orders) za celé trvání vztahu

// Predikovaná LTV (forward-looking)
predicted_ltv = (historical_ltv / months_as_customer * 12)    -- annualized AOV×freq
              × MAX(0.5, 3 - (churn_probability * 5))          -- lifespan faktor
              × recency_adjustment_factor                      -- penalizace neaktivity

// Recency adjustment:
//   nakoupil poslední 30 dní → 1.0
//   nakoupil 31-90 dní → 0.85
//   nakoupil 91-180 dní → 0.65
//   nakoupil 181-365 dní → 0.40
//   > 365 dní → 0.15
```

### LTV Segmenty (Champions framework)

```
                 High LTV (> 50 000 Kč)   Medium LTV (10-50K Kč)   Low LTV (< 10K Kč)
                ┌──────────────────────┬────────────────────────┬──────────────────┐
Recent          │   CHAMPIONS          │   LOYAL                │   PROMISING      │
(< 30 dní)     │   Udržuj + upsell    │   Loyalty program      │   Nurture        │
                ├──────────────────────┼────────────────────────┼──────────────────┤
Mid             │   AT RISK            │   NEED ATTENTION       │   ABOUT TO SLEEP │
(31-90 dní)    │   Win-back urgentně  │   Reaktivace           │   Re-engagement  │
                ├──────────────────────┼────────────────────────┼──────────────────┤
Stale           │   CANT LOSE THEM     │   HIBERNATING          │   LOST           │
(> 90 dní)     │   Kontaktovat osobně │   Email série          │   Nízká priorita │
                └──────────────────────┴────────────────────────┴──────────────────┘
```

### Napojení na churn-prediction

Existující `churn-prediction` modul počítá `churn_probability` (0–1) pro season pass holdery. SCV tento score integruje do LTV výpočtu jako `churn_probability` faktor. Pro uživatele bez season passu se používá behaviorální proxy:

```typescript
// Pro non-pass users: empirická churn probability z recency
function estimateChurnProbabilityFromRecency(daysSinceLastPurchase: number): number {
  if (daysSinceLastPurchase <= 30) return 0.05;
  if (daysSinceLastPurchase <= 90) return 0.20;
  if (daysSinceLastPurchase <= 180) return 0.45;
  if (daysSinceLastPurchase <= 365) return 0.70;
  return 0.90;
}
```

### Business využití LTV

| LTV segment | Max CAC (acquisition) | Max CRC (retention) | Personalizace |
|---|---|---|---|
| Champions (>50K) | 1 500 Kč | 500 Kč/rok | VIP treatment, early access |
| Loyal (10-50K) | 600 Kč | 200 Kč/rok | Loyalty rewards, upsell |
| Promising (<10K, new) | 200 Kč | 80 Kč/rok | Onboarding, 2. nákup |
| At Risk (high LTV, stale) | N/A | 800 Kč/rok | Win-back kampaň, discount |
| Lost (> 1 rok) | 50 Kč (retargeting) | N/A | GDPR-compliant retargeting |

---

## 4. Fan segmenty a personalizace

### RFM matice — napojení na audience-segmentation

Existující `audience-segmentation` již má `RfmFilter` interface s `recencyDays`, `minFrequency`, `minMonetaryValue`. SCV rozšiřuje tuto logiku o **materialized RFM score** uložený přímo v `fan.profiles`:

```
rfm_recency_score:   1-5 (5 = nakoupil dnes, 1 = > 1 rok)
rfm_frequency_score: 1-5 (5 = top 20% kupujících, 1 = bottom 20%)
rfm_monetary_score:  1-5 (5 = top 20% dle spend, 1 = bottom 20%)
rfm_combined:        "555" → "Champions", "111" → "Lost Customers"
```

RFM skóre se počítá **relativně v rámci každého promotéra** (platformový zásah: promotér-A má jiné zákazníky než promotér-B, absolutní prahové hodnoty by nefungovaly cross-promotér).

### Dynamické segmenty

Segmenty jsou dvou typů:

**1. Statické (existující audience-segmentation):** promotér definuje filter, segment se refreshuje dle plánu.

**2. Dynamické platform-level segmenty:** automaticky aktualizovány SCV batchem:
- `ltv_champions` — fans s LTV > 50 000 Kč, aktivní poslední 30 dní
- `churn_risk_high` — churn_probability > 0.7
- `rfm_loyal` — RFM score "4x4x4" nebo lepší
- `genre_electronic_fans` — genre_vector["electronic"] > 0.5
- `price_sensitive` — price_sensitivity < 0.3
- `high_value_dormant` — LTV > 20 000 Kč, poslední nákup > 90 dní

### Co promotér vidí vs. platform-only

```
┌──────────────────────────────────────────────────────────────────┐
│  PROMOTER-VISIBLE (přes fan.promoter_views view)                 │
│                                                                  │
│  ✓ Jejich zákazníci — email, jméno, město                        │
│  ✓ RFM skóre pro jejich eventy                                   │
│  ✓ Loyalty tier a body (jen pokud fan nakoupil u nich)           │
│  ✓ Komunikační preference (opt-in/out pro jejich kampaně)        │
│  ✓ Anonymizovaný churn score ("high/medium/low risk" label)      │
│  ✓ Segment membership pro jejich vlastní segmenty                │
│  ✓ Počet eventů zakoupených u jejich organizace                  │
├──────────────────────────────────────────────────────────────────┤
│  PLATFORM-ONLY (nikdy nesdíleno s promotéry)                     │
│                                                                  │
│  ✗ Cross-promotér nákupní history (co kupuje u jiných)           │
│  ✗ Absolutní LTV číslo                                           │
│  ✗ Přesná churn_probability hodnota (float)                      │
│  ✗ BankID verifikační data                                       │
│  ✗ Identity graph (propojení účtů)                               │
│  ✗ Device fingerprints                                           │
│  ✗ Preference vektory (jsou platform IP)                         │
│  ✗ Resale chování u jiných promotérů                             │
└──────────────────────────────────────────────────────────────────┘
```

### Cross-promotér insights (anonymizované agregáty)

Promotér může vidět anonymizované insights přes dedikované API:

```
GET /api/fan/insights/genre-affinity?genre=electronic&city=Prague
→ { fanCount: 4200, avgLtv: "medium", topCoEvents: ["Glastonbury CZ", ...] }
  (nikdy jednotlivé identity, vždy MIN_COHORT_SIZE = 100 fanů)
```

---

## 5. Data governance — multi-promotér kontext

### RLS pro fan schéma

Fan schéma musí implementovat **dvouúrovňové RLS**:

1. **Buyer level** (`role = 'buyer'`): fan vidí pouze svůj profil
2. **Promoter level** (`role = 'promoter'`): promotér vidí jen fany, kteří nakoupili u něho
3. **Admin/Service** (`role = 'admin'` nebo `role = 'service'`): plný přístup

```sql
-- fan.profiles RLS
ALTER TABLE fan.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY fan_profiles_buyer ON fan.profiles
  FOR SELECT
  USING (
    current_setting('app.current_role', TRUE) = 'buyer'
    AND user_id = current_setting('app.current_user_id', TRUE)::UUID
  );

CREATE POLICY fan_profiles_promoter ON fan.profiles
  FOR SELECT
  USING (
    current_setting('app.current_role', TRUE) = 'promoter'
    AND user_id IN (
      SELECT DISTINCT user_id FROM fan.promoter_customer_index
      WHERE promoter_id = current_setting('app.current_promoter_id', TRUE)::UUID
    )
  );

CREATE POLICY fan_profiles_platform ON fan.profiles
  FOR ALL
  USING (
    current_setting('app.current_role', TRUE) IN ('admin', 'service')
  );
```

### GDPR compliance

**Right to Erasure:** Při přijetí Kafka eventu `identity.user_gdpr_erasure_requested`:
1. `fan.profiles`: anonymizovat PII pole (jméno → NULL, email → SHA-256 hash)
2. `fan.event_history`: smazat záznamy (nejsou EET-relevantní)
3. `fan.ltv_scores`: smazat
4. `fan.segment_memberships`: smazat
5. `fan.preference_vectors`: smazat
6. `fan.identity_graph`: smazat
7. `fan.communication_prefs`: smazat

`orders.orders` a `tickets.tickets` zůstávají (EET compliance — 10 let retence), ale bez PII odkazu na fana (user_id zůstává jako UUID, ale PII jsou pryč z `identity.users`).

**Data minimization:** `fan.profiles` neukládá surové event logy — jen agregáty. Surové stránkové zobrazení je v `ai.user_browsing_events` s TTL 90 dní.

**Purpose limitation:** Promotér dostupné API (`/api/promoter/fan/...`) vrací pouze data relevantní pro jejich marketing. Platform API (`/api/admin/fan/...`) pro interní use-cases.

---

## 6. Fan identity resolution

### Strategie

Identity resolution pracuje ve třech vrstvách:

```
Vrstva 1: Deterministický matching (groundtruth)
├── Stejné bank_id_sub_hash z identity.verified_persons
└── Explicitní sloučení uživatelem ("propojit účty")

Vrstva 2: Vysoká spolehlivost
├── Stejný phone_hash + stejný email_hash
└── Stejný email na různých doménách (normalizace)

Vrstva 3: Probabilistický matching
├── Stejné příjmení + stejné telefonní číslo + stejné město → 0.85+
├── Stejné jméno + příjmení + věkové rozmezí + město → 0.70+
└── Device fingerprint match + behaviorální podobnost → 0.65+
```

### BankID deduplication

```sql
-- identity.verified_persons obsahuje bank_id_sub_hash (SHA-256 BankID subject)
-- Pokud dva user_id mají stejný bank_id_sub_hash → jsou stejná osoba

SELECT vp1.user_id AS user_id_1, vp2.user_id AS user_id_2
FROM identity.verified_persons vp1
JOIN identity.verified_persons vp2
  ON vp1.bank_id_sub_hash = vp2.bank_id_sub_hash
  AND vp1.user_id != vp2.user_id;
```

### fan.identity_graph tabulka

Ukládá propojení s confidence score a zdrojem. Nové identity resolution entries se projevují v SCV jako sjednocení dat — nákupní historie se agreguje přes všechny propojené profily.

### QR scan → online profil propojení

Při skenování vstupenky na eventu (`tickets.scan_events`):
1. Ticket je spojen s `user_id`
2. Pokud je scanner offline a propojuje anonymní vstupenku → offline event se odešle po sync
3. Kafka event `ticket.scanned` napájí `fan.event_history` s kontextem eventu

---

## 7. Data freshness a pipeline architektura

### Lambda architektura pro SCV

```
┌─────────────────────────────────────────────────────────────────┐
│                    LAMBDA ARCHITEKTURA                          │
│                                                                 │
│  SPEED LAYER (real-time, Kafka consumers)                       │
│  ┌──────────────────────────────────────────────────────┐      │
│  │  Kafka Topic            SCV Update                   │      │
│  │  ─────────────────────────────────────────────────   │      │
│  │  order.completed     → profiles.last_purchase_at     │      │
│  │                         profiles.total_orders_count  │      │
│  │                         profiles.total_spend_halire  │      │
│  │                         event_history INSERT         │      │
│  │  loyalty.points      → profiles.loyalty_points       │      │
│  │                         profiles.loyalty_tier        │      │
│  │  identity.updated    → profiles.email, name, phone   │      │
│  │  ticket.scanned      → event_history UPDATE          │      │
│  │  resale.sold         → profiles.resale_sold_count    │      │
│  │  referral.converted  → profiles.referral_count       │      │
│  └──────────────────────────────────────────────────────┘      │
│                                                                 │
│  BATCH LAYER (denní/hodinové joby)                              │
│  ┌──────────────────────────────────────────────────────┐      │
│  │  04:00  send-time-batch      → comm_prefs.best_send  │      │
│  │  05:00  rfm-score-batch      → profiles.rfm_*        │      │
│  │  06:00  churn-scoring-job    → ltv_scores.churn_prob │      │
│  │  07:00  ltv-scoring-batch    → ltv_scores INSERT      │      │
│  │  08:00  segment-refresh      → segment_memberships   │      │
│  │  */6h   preference-sync      → preference_vectors    │      │
│  └──────────────────────────────────────────────────────┘      │
│                                                                 │
│  SERVING LAYER (read API)                                       │
│  ┌──────────────────────────────────────────────────────┐      │
│  │  GET /api/fan/profile/:userId    → fan.profiles      │      │
│  │  GET /api/fan/segments/:userId   → fan.segments      │      │
│  │  GET /api/promoter/fans          → fan.promoter_views│      │
│  │  GET /api/fan/ltv/:userId        → fan.ltv_scores    │      │
│  └──────────────────────────────────────────────────────┘      │
└─────────────────────────────────────────────────────────────────┘
```

### Konzistence při paralelních zápisech

Kafka consumer pro SCV zpracovává eventy **sekvenčně per user_id** (partition key = user_id). Tím se zabrání race conditions. Postgres UPSERT (`INSERT ... ON CONFLICT DO UPDATE`) zajišťuje idempotenci při retry.

Pro batch joby se používá **optimistic locking** přes `updated_at` timestamp — batch nepřepíše novější data z real-time Kafka consumeru.

### Kafka topics konzumované SCV

| Topic | Klíčová pole | Efekt na fan profil |
|---|---|---|
| `order.completed` | orderId, userId, eventId, totalAmount, occurredAt | Aktualizace last_purchase_at, total_orders, total_spend; INSERT event_history |
| `order.refunded` | orderId, userId, refundAmount | Odečtení od total_spend; UPDATE event_history |
| `loyalty.points_earned` | userId, points, newBalance, tier | Aktualizace loyalty_points, loyalty_tier |
| `loyalty.points_redeemed` | userId, points, newBalance | Aktualizace loyalty_points |
| `loyalty.tier_upgraded` | userId, newTier | Aktualizace loyalty_tier, INSERT do tier_history |
| `identity.user_updated` | userId, email, firstName, lastName, phone | Aktualizace PII polí v profiles |
| `identity.user_verified` | userId, verificationType, loaLevel | Aktualizace verification_status |
| `identity.user_gdpr_erasure` | userId | Anonymizace PII, smazání event history |
| `ticket.scanned` | ticketId, userId, eventId, scannedAt | UPDATE event_history.attended = true |
| `resale.listing_created` | listingId, sellerId, eventId | Inkrementace resale_sold_count |
| `resale.purchase_completed` | listingId, buyerId, price | INSERT event_history (resale buy) |
| `referral.link_converted` | referralCode, referrerId, newUserId | Inkrementace referral_conversions |
| `churn.scored` | passId, userId, churnProbability | UPDATE ltv_scores.churn_probability |
| `cart.abandoned` | userId, eventId, amount | UPDATE profiles.cart_abandonment_count |
| `wishlist.added` | userId, eventId | Aktualizace preference_vectors |

---

## 8. Analytics a reporting

### Fan 360° view pro promotéra (dashboard)

Promotér vidí agregované metriky za **své zákazníky**:

```
┌─────────────────────────────────────────────────────────────────┐
│  FAN 360° DASHBOARD — Promotér view                            │
├─────────────────────────────────────────────────────────────────┤
│  PŘEHLED ZÁKAZNÍKŮ:                                             │
│  • Celkem zákazníků: 4 281                                      │
│  • Aktivní (30 dní): 892 (20.8%)                                │
│  • Champions: 145 (3.4%)                                        │
│  • At Risk: 312 (7.3%)                                          │
│  • Prům. LTV kategorie: "Medium"                               │
│                                                                 │
│  TOP ŽÁNRY jejich zákazníků:                                    │
│  Electronic 42% | Rock 28% | Pop 18% | Jazz 12%                 │
│                                                                 │
│  KOMUNIKAČNÍ KANÁLY:                                            │
│  Email opt-in: 78% | SMS opt-in: 34% | Push: 61%               │
│                                                                 │
│  LOAJALITA:                                                     │
│  Gold+Platinum: 23% | Silver: 41% | Bronze: 36%                │
│                                                                 │
│  SEGMENTY (jejich definice):                                    │
│  [Pravidelní kupci] 1 204 fanů | [VIP Praha] 89 fanů            │
└─────────────────────────────────────────────────────────────────┘
```

### Platform-level analytics (admin)

Admin vidí cross-promotér metriky:

- Celkové LTV distribuce platformy
- Identity resolution merge rate
- Churn heatmapy dle žánru / věkové skupiny
- Platform-wide RFM distribuce
- Data quality metriky (% profilů s kompletními daty)

### Export segmentů pro kampaně — napojení na optimal-send-time

```typescript
// Export flow:
// 1. Promotér vybere segment v dashboardu
// 2. API zavolá audience-segmentation (existující) pro email list
// 3. Pro každý email se zavolá optimal-send-time batch endpoint
// 4. Výsledek: seznam { email, bestSendHour, bestSendDay } pro Mailgun

GET /api/promoter/segments/:segmentId/export-with-sendtime
→ {
    emails: Array<{
      email: string;
      bestHour: number;     // z optimal-send-time
      bestDay: number;      // z optimal-send-time
      confidence: number;
    }>;
    exportedAt: string;
  }
```

### Integrace s server-side-tracking

SCV obohacuje tracking payloady o fan data:

```typescript
// Při OrderCompleted Kafka eventu:
// server-side-tracking odešle do Meta/TikTok obohacený payload
// SCV přidá: lifetimeValue, customerSegment (anonymizovaně)

// Meta Conversions API custom_data rozšíření:
{
  currency: "CZK",
  value: 129900,          // haléře → Kč při odesílání
  content_ids: ["event-uuid"],
  // SCV enrichment:
  predicted_ltv: 45000,   // z fan.ltv_scores (v Kč pro Meta)
  customer_type: "returning"  // "new" | "returning" | "vip"
}
```

---

## 9. DB schéma — SQL CREATE TABLE

```sql
-- =============================================================================
-- SCHÉMA: fan
-- Single Customer View — read model, denormalizovaný agregát
-- Zodpovědnost: unified fan profil, LTV, segmenty, preference, identity graph
-- Všechny částky v INTEGER haléřích. Nikdy FLOAT pro peníze.
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS fan;

-- =============================================================================
-- fan.profiles — hlavní read model, denormalizovaný fan profil
-- Aktualizován Kafka consumerem (<15s) a batch joby (denně)
-- =============================================================================

CREATE TABLE fan.profiles (
    -- Primární klíč = identity.users.id (bez FK — cross-schema)
    user_id                     UUID            PRIMARY KEY,

    -- ── PII (anonymizovatelná při GDPR erasure) ─────────────────────────────
    email                       TEXT,           -- NULL po anonymizaci
    first_name                  TEXT,
    last_name                   TEXT,
    phone                       TEXT,
    city                        TEXT,           -- primární město dle IP/adresa
    country                     CHAR(2),        -- ISO 3166-1 alpha-2

    -- ── Verifikační status ──────────────────────────────────────────────────
    email_verified              BOOLEAN         NOT NULL DEFAULT FALSE,
    phone_verified              BOOLEAN         NOT NULL DEFAULT FALSE,
    bankid_verified             BOOLEAN         NOT NULL DEFAULT FALSE,
    bankid_loa_level            TEXT            CHECK (bankid_loa_level IN ('low', 'substantial', 'high')),
    -- Nikdy raw BankID data — jen příznak a LOA level

    -- ── Nákupní agregáty (halíře) ────────────────────────────────────────────
    total_orders_count          INTEGER         NOT NULL DEFAULT 0,
    total_spend_halire          BIGINT          NOT NULL DEFAULT 0,   -- lifetime spend
    total_refunds_halire        BIGINT          NOT NULL DEFAULT 0,
    net_spend_halire            BIGINT          GENERATED ALWAYS AS (total_spend_halire - total_refunds_halire) STORED,
    first_purchase_at           TIMESTAMPTZ,
    last_purchase_at            TIMESTAMPTZ,
    -- Průměrná hodnota objednávky (počítána v batch, haléře)
    avg_order_value_halire      INTEGER         NOT NULL DEFAULT 0,
    -- Nákupní frekvence — objednávky za poslední 365 dní
    purchase_frequency_365d     NUMERIC(5,2)    NOT NULL DEFAULT 0,

    -- ── RFM skóre (1-5, počítáno relativně v rámci platformy) ───────────────
    rfm_recency_score           SMALLINT        CHECK (rfm_recency_score BETWEEN 1 AND 5),
    rfm_frequency_score         SMALLINT        CHECK (rfm_frequency_score BETWEEN 1 AND 5),
    rfm_monetary_score          SMALLINT        CHECK (rfm_monetary_score BETWEEN 1 AND 5),
    -- "553", "111" apod.
    rfm_combined                CHAR(3),
    rfm_segment_label           TEXT,           -- 'Champions', 'Loyal', 'At Risk', ...
    rfm_computed_at             TIMESTAMPTZ,

    -- ── Loyalty ─────────────────────────────────────────────────────────────
    loyalty_total_points        INTEGER         NOT NULL DEFAULT 0,
    loyalty_lifetime_points     INTEGER         NOT NULL DEFAULT 0,
    loyalty_tier                TEXT            DEFAULT 'bronze'
        CHECK (loyalty_tier IN ('bronze', 'silver', 'gold', 'platinum')),
    loyalty_expires_at          TIMESTAMPTZ,

    -- ── Komunikační preference ───────────────────────────────────────────────
    email_opt_in                BOOLEAN         NOT NULL DEFAULT TRUE,
    sms_opt_in                  BOOLEAN         NOT NULL DEFAULT FALSE,
    push_opt_in                 BOOLEAN         NOT NULL DEFAULT FALSE,
    marketing_opt_in            BOOLEAN         NOT NULL DEFAULT TRUE,
    -- Napojení na optimal-send-time
    best_send_hour              SMALLINT        CHECK (best_send_hour BETWEEN 0 AND 23),
    best_send_day               SMALLINT        CHECK (best_send_day BETWEEN 0 AND 6),
    send_time_confidence        NUMERIC(4,3),   -- 0.0–1.0
    send_time_computed_at       TIMESTAMPTZ,

    -- ── Aktivity ────────────────────────────────────────────────────────────
    resale_sold_count           INTEGER         NOT NULL DEFAULT 0,
    resale_bought_count         INTEGER         NOT NULL DEFAULT 0,
    referral_conversions_count  INTEGER         NOT NULL DEFAULT 0,
    cart_abandonment_count      INTEGER         NOT NULL DEFAULT 0,
    wishlist_count              INTEGER         NOT NULL DEFAULT 0,

    -- ── Churn & LTV (aktualizováno batch joby) ───────────────────────────────
    -- Canonical churn probability z nejnovějšího ltv_scores záznamu
    current_churn_probability   NUMERIC(5,4)    CHECK (current_churn_probability BETWEEN 0 AND 1),
    -- LTV v haléřích (INTEGER, nikdy float)
    predicted_ltv_halire        BIGINT          NOT NULL DEFAULT 0,
    ltv_segment                 TEXT            CHECK (ltv_segment IN (
                                    'champions', 'loyal', 'promising',
                                    'at_risk', 'need_attention', 'about_to_sleep',
                                    'cant_lose_them', 'hibernating', 'lost', 'new'
                                )),
    ltv_computed_at             TIMESTAMPTZ,

    -- ── Platform metadata ────────────────────────────────────────────────────
    -- Fan profil byl smazán (GDPR soft delete)
    anonymized_at               TIMESTAMPTZ,
    -- Počet propojených identit v identity_graph
    identity_merge_count        SMALLINT        NOT NULL DEFAULT 0,
    -- Kafka offset poslední zpracované zprávy (pro idempotenci)
    last_kafka_offset           BIGINT,

    created_at                  TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE fan.profiles IS
    'Single Customer View — denormalizovaný read model, agreguje data z identity, orders, loyalty, passes, resale. '
    'Aktualizován Kafka consumerem a batch joby. Nikdy nepoužívat pro zápis do source-of-truth schémat.';

COMMENT ON COLUMN fan.profiles.net_spend_halire IS
    'Computed column: total_spend - total_refunds. V haléřích (INTEGER).';
COMMENT ON COLUMN fan.profiles.rfm_combined IS
    'Třímístný RFM kód: recency+frequency+monetary (1-5). Např. "555" = Champion, "111" = Lost.';

-- Indexy pro časté dotazy
CREATE INDEX idx_fan_profiles_ltv_segment ON fan.profiles (ltv_segment) WHERE anonymized_at IS NULL;
CREATE INDEX idx_fan_profiles_loyalty_tier ON fan.profiles (loyalty_tier) WHERE anonymized_at IS NULL;
CREATE INDEX idx_fan_profiles_rfm_combined ON fan.profiles (rfm_combined) WHERE anonymized_at IS NULL;
CREATE INDEX idx_fan_profiles_last_purchase ON fan.profiles (last_purchase_at DESC NULLS LAST);
CREATE INDEX idx_fan_profiles_churn ON fan.profiles (current_churn_probability DESC) WHERE anonymized_at IS NULL;

-- RLS
ALTER TABLE fan.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY fan_profiles_buyer ON fan.profiles
    FOR SELECT TO PUBLIC
    USING (
        current_setting('app.current_role', TRUE) = 'buyer'
        AND user_id = current_setting('app.current_user_id', TRUE)::UUID
    );

-- Promotér vidí pouze fany ze své "promoter_customer_index" view
-- (definováno níže)
CREATE POLICY fan_profiles_promoter ON fan.profiles
    FOR SELECT TO PUBLIC
    USING (
        current_setting('app.current_role', TRUE) = 'promoter'
        AND EXISTS (
            SELECT 1 FROM fan.promoter_customer_index pci
            WHERE pci.promoter_id = current_setting('app.current_promoter_id', TRUE)::UUID
              AND pci.user_id = fan.profiles.user_id
        )
    );

CREATE POLICY fan_profiles_service ON fan.profiles
    FOR ALL TO PUBLIC
    USING (current_setting('app.current_role', TRUE) IN ('admin', 'service'));

CREATE TRIGGER trg_fan_profiles_updated_at
    BEFORE UPDATE ON fan.profiles
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =============================================================================
-- fan.promoter_customer_index — index promotér → zákazníci
-- Naplňován Kafka consumerem při order.completed
-- Umožňuje rychlé RLS filtrování
-- =============================================================================

CREATE TABLE fan.promoter_customer_index (
    promoter_id     UUID            NOT NULL,
    user_id         UUID            NOT NULL,
    first_order_at  TIMESTAMPTZ     NOT NULL,
    last_order_at   TIMESTAMPTZ     NOT NULL,
    order_count     INTEGER         NOT NULL DEFAULT 1,
    total_spend_halire BIGINT       NOT NULL DEFAULT 0,

    PRIMARY KEY (promoter_id, user_id)
);

CREATE INDEX idx_fan_pci_user_id ON fan.promoter_customer_index (user_id);
CREATE INDEX idx_fan_pci_promoter_last_order ON fan.promoter_customer_index (promoter_id, last_order_at DESC);

ALTER TABLE fan.promoter_customer_index ENABLE ROW LEVEL SECURITY;

CREATE POLICY fan_pci_promoter ON fan.promoter_customer_index
    FOR SELECT TO PUBLIC
    USING (
        current_setting('app.current_role', TRUE) IN ('admin', 'service')
        OR (
            current_setting('app.current_role', TRUE) = 'promoter'
            AND promoter_id = current_setting('app.current_promoter_id', TRUE)::UUID
        )
    );

-- =============================================================================
-- fan.event_history — záznamy o zakoupených a navštívených eventech
-- =============================================================================

CREATE TABLE fan.event_history (
    id                  UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID            NOT NULL,   -- FK na fan.profiles
    -- Event metadata (denormalizováno — kopie v čase nákupu)
    event_id            UUID            NOT NULL,   -- catalog.events.id
    event_title         TEXT            NOT NULL,
    event_category      TEXT,
    event_date          TIMESTAMPTZ,
    venue_id            UUID,
    venue_name          TEXT,
    venue_city          TEXT,
    promoter_id         UUID            NOT NULL,
    -- Transakce
    order_id            UUID,                       -- orders.orders.id
    ticket_type_id      UUID,
    ticket_kind         TEXT,                       -- 'standing', 'seated', 'season_pass', 'bundle'
    amount_paid_halire  INTEGER         NOT NULL DEFAULT 0,  -- haléře
    currency            CHAR(3)         NOT NULL DEFAULT 'CZK',
    source              TEXT            NOT NULL
        CHECK (source IN ('primary', 'resale', 'gift', 'season_pass', 'comp')),
    -- Stav účasti
    attended            BOOLEAN,                    -- NULL = neznámo, TRUE = prošel turniketem
    scanned_at          TIMESTAMPTZ,
    -- Metadata
    purchased_at        TIMESTAMPTZ     NOT NULL,
    refunded_at         TIMESTAMPTZ,
    created_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_fan_event_history_user_id ON fan.event_history (user_id);
CREATE INDEX idx_fan_event_history_promoter ON fan.event_history (promoter_id, user_id);
CREATE INDEX idx_fan_event_history_event_id ON fan.event_history (event_id);
CREATE INDEX idx_fan_event_history_purchased_at ON fan.event_history (user_id, purchased_at DESC);
CREATE INDEX idx_fan_event_history_category ON fan.event_history (user_id, event_category);

ALTER TABLE fan.event_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY fan_event_history_buyer ON fan.event_history
    FOR SELECT TO PUBLIC
    USING (
        current_setting('app.current_role', TRUE) = 'buyer'
        AND user_id = current_setting('app.current_user_id', TRUE)::UUID
    );

CREATE POLICY fan_event_history_promoter ON fan.event_history
    FOR SELECT TO PUBLIC
    USING (
        current_setting('app.current_role', TRUE) = 'promoter'
        AND promoter_id = current_setting('app.current_promoter_id', TRUE)::UUID
    );

CREATE POLICY fan_event_history_service ON fan.event_history
    FOR ALL TO PUBLIC
    USING (current_setting('app.current_role', TRUE) IN ('admin', 'service'));

CREATE TRIGGER trg_fan_event_history_updated_at
    BEFORE UPDATE ON fan.event_history
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =============================================================================
-- fan.ltv_scores — LTV skóre s historií výpočtů
-- =============================================================================

CREATE TABLE fan.ltv_scores (
    id                      UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                 UUID            NOT NULL,
    -- LTV komponenty (haléře)
    avg_order_value_halire  INTEGER         NOT NULL,
    purchase_frequency_annual NUMERIC(5,2)  NOT NULL,
    predicted_lifespan_years  NUMERIC(4,2)  NOT NULL,
    -- Churn integration
    churn_probability       NUMERIC(5,4)    NOT NULL CHECK (churn_probability BETWEEN 0 AND 1),
    churn_source            TEXT            NOT NULL
        CHECK (churn_source IN ('pass_model', 'recency_heuristic', 'default')),
    -- LTV výsledky (haléře — INTEGER)
    historical_ltv_halire   BIGINT          NOT NULL DEFAULT 0,
    predicted_ltv_halire    BIGINT          NOT NULL DEFAULT 0,
    -- Segmentace
    ltv_segment             TEXT            NOT NULL
        CHECK (ltv_segment IN (
            'champions', 'loyal', 'promising',
            'at_risk', 'need_attention', 'about_to_sleep',
            'cant_lose_them', 'hibernating', 'lost', 'new'
        )),
    -- Metadata
    model_version           TEXT            NOT NULL,
    computed_at             TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    -- Recency adjustment faktor použitý při výpočtu
    recency_adjustment      NUMERIC(4,3)    NOT NULL
);

CREATE INDEX idx_fan_ltv_scores_user_id ON fan.ltv_scores (user_id, computed_at DESC);
CREATE INDEX idx_fan_ltv_scores_segment ON fan.ltv_scores (ltv_segment, computed_at DESC);

-- Bez RLS — přístup pouze přes service role
ALTER TABLE fan.ltv_scores ENABLE ROW LEVEL SECURITY;

CREATE POLICY fan_ltv_scores_service ON fan.ltv_scores
    FOR ALL TO PUBLIC
    USING (current_setting('app.current_role', TRUE) IN ('admin', 'service'));

CREATE POLICY fan_ltv_scores_buyer ON fan.ltv_scores
    FOR SELECT TO PUBLIC
    USING (
        current_setting('app.current_role', TRUE) = 'buyer'
        AND user_id = current_setting('app.current_user_id', TRUE)::UUID
    );

-- =============================================================================
-- fan.segments — definice platform-level segmentů (doplněk ke segmentation.segments)
-- =============================================================================

CREATE TABLE fan.segments (
    id              UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    -- NULL = platform segment (viditelný všem promotérům v anonymizované podobě)
    -- UUID = promotér-specifický segment (viditelný jen danému promotérovi)
    promoter_id     UUID,
    name            TEXT            NOT NULL,
    description     TEXT,
    -- 'dynamic' = automaticky refreshovaný, 'static' = manuální
    segment_type    TEXT            NOT NULL DEFAULT 'dynamic'
        CHECK (segment_type IN ('dynamic', 'static', 'ltv_based', 'rfm_based', 'churn_based')),
    -- JSONB kritéria pro dynamické segmenty
    criteria        JSONB,
    -- Počet členů (refreshovaný při každém batch runu)
    member_count    INTEGER         NOT NULL DEFAULT 0,
    -- Kdy byl segment naposledy refreshován
    last_refreshed_at TIMESTAMPTZ,
    is_active       BOOLEAN         NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_fan_segments_promoter ON fan.segments (promoter_id) WHERE promoter_id IS NOT NULL;
CREATE INDEX idx_fan_segments_type ON fan.segments (segment_type, is_active);

ALTER TABLE fan.segments ENABLE ROW LEVEL SECURITY;

CREATE POLICY fan_segments_promoter ON fan.segments
    FOR SELECT TO PUBLIC
    USING (
        current_setting('app.current_role', TRUE) = 'promoter'
        AND (
            promoter_id = current_setting('app.current_promoter_id', TRUE)::UUID
            OR promoter_id IS NULL  -- platform-level segmenty jsou viditelné všem
        )
    );

CREATE POLICY fan_segments_service ON fan.segments
    FOR ALL TO PUBLIC
    USING (current_setting('app.current_role', TRUE) IN ('admin', 'service'));

CREATE TRIGGER trg_fan_segments_updated_at
    BEFORE UPDATE ON fan.segments
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =============================================================================
-- fan.segment_memberships — přiřazení fanů do segmentů
-- =============================================================================

CREATE TABLE fan.segment_memberships (
    segment_id      UUID            NOT NULL REFERENCES fan.segments (id) ON DELETE CASCADE,
    user_id         UUID            NOT NULL,
    -- Score/relevance pro ranking v rámci segmentu (volitelné)
    relevance_score NUMERIC(6,4),
    assigned_at     TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    expires_at      TIMESTAMPTZ,    -- NULL = neexpiruje

    PRIMARY KEY (segment_id, user_id)
);

CREATE INDEX idx_fan_segment_memberships_user ON fan.segment_memberships (user_id);
CREATE INDEX idx_fan_segment_memberships_segment ON fan.segment_memberships (segment_id, assigned_at DESC);

ALTER TABLE fan.segment_memberships ENABLE ROW LEVEL SECURITY;

CREATE POLICY fan_segment_memberships_service ON fan.segment_memberships
    FOR ALL TO PUBLIC
    USING (current_setting('app.current_role', TRUE) IN ('admin', 'service'));

-- Promotér vidí jen membership pro své segmenty
CREATE POLICY fan_segment_memberships_promoter ON fan.segment_memberships
    FOR SELECT TO PUBLIC
    USING (
        current_setting('app.current_role', TRUE) = 'promoter'
        AND EXISTS (
            SELECT 1 FROM fan.segments s
            WHERE s.id = fan.segment_memberships.segment_id
              AND (
                s.promoter_id = current_setting('app.current_promoter_id', TRUE)::UUID
                OR s.promoter_id IS NULL
              )
        )
    );

-- =============================================================================
-- fan.preference_vectors — preference pro recommendation engine
-- Nahrazuje/doplňuje ai.user_features z recommendation-engine
-- =============================================================================

CREATE TABLE fan.preference_vectors (
    user_id             UUID            PRIMARY KEY,
    -- Žánrový vektor: { "electronic": 0.7, "rock": 0.3 } — JSONB
    genre_vector        JSONB           NOT NULL DEFAULT '{}',
    -- Oblíbená města
    preferred_cities    TEXT[]          NOT NULL DEFAULT '{}',
    -- Oblíbení promotéři (seřazeni dle engagement)
    preferred_promoter_ids UUID[]       NOT NULL DEFAULT '{}',
    -- Cenová citlivost [0,1]: 0 = price-sensitive, 1 = insensitive
    price_sensitivity   NUMERIC(4,3)    NOT NULL DEFAULT 0.5
        CHECK (price_sensitivity BETWEEN 0 AND 1),
    -- Preferovaný čas eventu: 'afternoon', 'evening', 'weekend'
    preferred_time_slots TEXT[]         NOT NULL DEFAULT '{}',
    -- Průměrná vzdálenost v km, kterou je ochoten cestovat
    avg_travel_distance_km SMALLINT,
    -- Metoda výpočtu
    model_version       TEXT            NOT NULL DEFAULT '1.0',
    computed_at         TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_fan_pref_vectors_updated ON fan.preference_vectors (updated_at DESC);

ALTER TABLE fan.preference_vectors ENABLE ROW LEVEL SECURITY;

CREATE POLICY fan_pref_vectors_service ON fan.preference_vectors
    FOR ALL TO PUBLIC
    USING (current_setting('app.current_role', TRUE) IN ('admin', 'service'));

-- Buyer vidí jen svůj vektor (pro personalizaci v UI)
CREATE POLICY fan_pref_vectors_buyer ON fan.preference_vectors
    FOR SELECT TO PUBLIC
    USING (
        current_setting('app.current_role', TRUE) = 'buyer'
        AND user_id = current_setting('app.current_user_id', TRUE)::UUID
    );

CREATE TRIGGER trg_fan_pref_vectors_updated_at
    BEFORE UPDATE ON fan.preference_vectors
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =============================================================================
-- fan.identity_graph — propojení více identit jednoho reálného fana
-- =============================================================================

CREATE TABLE fan.identity_graph (
    id                  UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Primární (kanonický) user_id — vždy starší nebo BankID-verified
    primary_user_id     UUID            NOT NULL,
    -- Sekundární user_id — sloučen do primary
    secondary_user_id   UUID            NOT NULL,
    -- Zdroj propojení
    match_type          TEXT            NOT NULL
        CHECK (match_type IN (
            'bankid_dedup',         -- stejný bank_id_sub_hash
            'email_normalized',     -- normalizovaný email match
            'phone_email_match',    -- phone + email shoda
            'probabilistic',        -- ML matching (jméno + telefon + město)
            'user_initiated'        -- uživatel sám propojil účty
        )),
    -- Confidence score [0,1] (1.0 pro bankid_dedup a user_initiated)
    confidence          NUMERIC(4,3)    NOT NULL
        CHECK (confidence BETWEEN 0 AND 1),
    -- Kdy bylo propojení vytvořeno a kdo
    created_by          TEXT            NOT NULL
        CHECK (created_by IN ('system', 'user', 'admin')),
    created_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_fan_identity_graph_pair
        UNIQUE (primary_user_id, secondary_user_id),
    CONSTRAINT chk_fan_identity_graph_no_self
        CHECK (primary_user_id != secondary_user_id)
);

CREATE INDEX idx_fan_identity_graph_primary ON fan.identity_graph (primary_user_id);
CREATE INDEX idx_fan_identity_graph_secondary ON fan.identity_graph (secondary_user_id);

-- Pouze service role — nikdy promotéři
ALTER TABLE fan.identity_graph ENABLE ROW LEVEL SECURITY;

CREATE POLICY fan_identity_graph_service ON fan.identity_graph
    FOR ALL TO PUBLIC
    USING (current_setting('app.current_role', TRUE) IN ('admin', 'service'));

-- =============================================================================
-- fan.communication_prefs — granulární komunikační preference per-promotér
-- fan.profiles obsahuje platform-wide default; tato tabulka přepisuje per-promotér
-- =============================================================================

CREATE TABLE fan.communication_prefs (
    user_id             UUID            NOT NULL,
    -- NULL = platform-wide default
    promoter_id         UUID,
    channel             TEXT            NOT NULL
        CHECK (channel IN ('email', 'sms', 'push', 'whatsapp')),
    opted_in            BOOLEAN         NOT NULL DEFAULT TRUE,
    -- Proč se odhlásil (pokud opted_in = FALSE)
    opt_out_reason      TEXT            CHECK (opt_out_reason IN (
                            'user_unsubscribed', 'complaint', 'hard_bounce',
                            'gdpr_request', 'admin_action'
                        )),
    opted_at            TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    -- Optionally: tato preference platí jen pro určitý typ komunikace
    message_type        TEXT            CHECK (message_type IN (
                            'marketing', 'transactional', 'event_reminder',
                            'loyalty', 'all'
                        )) DEFAULT 'all',

    PRIMARY KEY (user_id, COALESCE(promoter_id, '00000000-0000-0000-0000-000000000000'::UUID), channel, COALESCE(message_type, 'all'))
);

CREATE INDEX idx_fan_comm_prefs_user ON fan.communication_prefs (user_id);
CREATE INDEX idx_fan_comm_prefs_promoter ON fan.communication_prefs (promoter_id) WHERE promoter_id IS NOT NULL;

ALTER TABLE fan.communication_prefs ENABLE ROW LEVEL SECURITY;

CREATE POLICY fan_comm_prefs_buyer ON fan.communication_prefs
    FOR ALL TO PUBLIC
    USING (
        current_setting('app.current_role', TRUE) = 'buyer'
        AND user_id = current_setting('app.current_user_id', TRUE)::UUID
    );

CREATE POLICY fan_comm_prefs_promoter ON fan.communication_prefs
    FOR SELECT TO PUBLIC
    USING (
        current_setting('app.current_role', TRUE) = 'promoter'
        AND promoter_id = current_setting('app.current_promoter_id', TRUE)::UUID
    );

CREATE POLICY fan_comm_prefs_service ON fan.communication_prefs
    FOR ALL TO PUBLIC
    USING (current_setting('app.current_role', TRUE) IN ('admin', 'service'));
```

---

## 10. TypeScript interface definice

```typescript
// =============================================================================
// single-customer-view/src/types/fan.types.ts
// =============================================================================

import type { LoyaltyTier } from '@tixly/loyalty-points';
import type { ChurnPrediction } from '@tixly/churn-prediction';

// ─── Core enums ───────────────────────────────────────────────────────────────

export type LtvSegment =
  | 'champions'
  | 'loyal'
  | 'promising'
  | 'at_risk'
  | 'need_attention'
  | 'about_to_sleep'
  | 'cant_lose_them'
  | 'hibernating'
  | 'lost'
  | 'new';

export type MatchType =
  | 'bankid_dedup'
  | 'email_normalized'
  | 'phone_email_match'
  | 'probabilistic'
  | 'user_initiated';

export type EventSource = 'primary' | 'resale' | 'gift' | 'season_pass' | 'comp';

export type CommChannel = 'email' | 'sms' | 'push' | 'whatsapp';

export type MessageType = 'marketing' | 'transactional' | 'event_reminder' | 'loyalty' | 'all';

// ─── Fan profile (read model) ─────────────────────────────────────────────────

export interface FanProfile {
  userId: string;

  // PII
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  city: string | null;
  country: string | null;

  // Verifikace
  emailVerified: boolean;
  phoneVerified: boolean;
  bankidVerified: boolean;
  bankidLoaLevel: 'low' | 'substantial' | 'high' | null;

  // Nákupní agregáty (haléře — vždy INTEGER)
  totalOrdersCount: number;
  totalSpendHalire: number;
  totalRefundsHalire: number;
  netSpendHalire: number;            // computed: total - refunds
  firstPurchaseAt: string | null;    // ISO 8601
  lastPurchaseAt: string | null;
  avgOrderValueHalire: number;
  purchaseFrequency365d: number;     // objednávky za rok

  // RFM (1-5)
  rfmRecencyScore: number | null;
  rfmFrequencyScore: number | null;
  rfmMonetaryScore: number | null;
  rfmCombined: string | null;        // "553"
  rfmSegmentLabel: string | null;    // "Champions"
  rfmComputedAt: string | null;

  // Loyalty
  loyaltyTotalPoints: number;
  loyaltyLifetimePoints: number;
  loyaltyTier: LoyaltyTier;
  loyaltyExpiresAt: string | null;

  // Komunikace
  emailOptIn: boolean;
  smsOptIn: boolean;
  pushOptIn: boolean;
  marketingOptIn: boolean;
  bestSendHour: number | null;       // 0-23
  bestSendDay: number | null;        // 0-6 (0=pondělí)
  sendTimeConfidence: number | null;

  // Aktivity
  resaleSoldCount: number;
  resaleBoughtCount: number;
  referralConversionsCount: number;
  cartAbandonmentCount: number;
  wishlistCount: number;

  // LTV & Churn
  currentChurnProbability: number | null;
  predictedLtvHalire: number;
  ltvSegment: LtvSegment | null;
  ltvComputedAt: string | null;

  // Metadata
  anonymizedAt: string | null;
  identityMergeCount: number;
  createdAt: string;
  updatedAt: string;
}

// ─── Fan event history ────────────────────────────────────────────────────────

export interface FanEventHistory {
  id: string;
  userId: string;
  eventId: string;
  eventTitle: string;
  eventCategory: string | null;
  eventDate: string | null;
  venueId: string | null;
  venueName: string | null;
  venueCity: string | null;
  promoterId: string;
  orderId: string | null;
  ticketTypeId: string | null;
  ticketKind: 'standing' | 'seated' | 'season_pass' | 'bundle' | null;
  amountPaidHalire: number;          // haléře — INTEGER
  currency: string;
  source: EventSource;
  attended: boolean | null;
  scannedAt: string | null;
  purchasedAt: string;
  refundedAt: string | null;
  createdAt: string;
}

// ─── LTV score ────────────────────────────────────────────────────────────────

export interface FanLtvScore {
  id: string;
  userId: string;
  avgOrderValueHalire: number;       // haléře
  purchaseFrequencyAnnual: number;
  predictedLifespanYears: number;
  churnProbability: number;          // 0-1
  churnSource: 'pass_model' | 'recency_heuristic' | 'default';
  historicalLtvHalire: number;       // haléře
  predictedLtvHalire: number;        // haléře
  ltvSegment: LtvSegment;
  recencyAdjustment: number;         // 0-1 multiplikátor
  modelVersion: string;
  computedAt: string;
}

// ─── Segment ──────────────────────────────────────────────────────────────────

export interface FanSegment {
  id: string;
  promoterId: string | null;         // null = platform-level
  name: string;
  description: string | null;
  segmentType: 'dynamic' | 'static' | 'ltv_based' | 'rfm_based' | 'churn_based';
  criteria: SegmentCriteria | null;
  memberCount: number;
  lastRefreshedAt: string | null;
  isActive: boolean;
  createdAt: string;
}

export interface SegmentCriteria {
  ltvSegments?: LtvSegment[];
  rfmCombined?: string[];            // ["554", "555", "545"]
  churnProbabilityMin?: number;
  churnProbabilityMax?: number;
  daysSinceLastPurchaseMax?: number;
  loyaltyTiers?: LoyaltyTier[];
  minTotalSpendHalire?: number;
  minOrderCount?: number;
  genres?: string[];
  cities?: string[];
}

// ─── Preference vector ────────────────────────────────────────────────────────

export interface FanPreferenceVector {
  userId: string;
  genreVector: Record<string, number>;  // { "electronic": 0.7, "rock": 0.3 }
  preferredCities: string[];
  preferredPromoterIds: string[];
  priceSensitivity: number;             // 0-1
  preferredTimeSlots: string[];
  avgTravelDistanceKm: number | null;
  modelVersion: string;
  computedAt: string;
}

// ─── Identity graph ───────────────────────────────────────────────────────────

export interface IdentityGraphEdge {
  id: string;
  primaryUserId: string;
  secondaryUserId: string;
  matchType: MatchType;
  confidence: number;               // 0-1
  createdBy: 'system' | 'user' | 'admin';
  createdAt: string;
}

// ─── Communication preference ─────────────────────────────────────────────────

export interface FanCommunicationPref {
  userId: string;
  promoterId: string | null;
  channel: CommChannel;
  optedIn: boolean;
  optOutReason: string | null;
  optedAt: string;
  messageType: MessageType;
}

// ─── Promoter customer index ──────────────────────────────────────────────────

export interface PromoterCustomerIndex {
  promoterId: string;
  userId: string;
  firstOrderAt: string;
  lastOrderAt: string;
  orderCount: number;
  totalSpendHalire: number;         // haléře
}

// ─── LTV computation input ────────────────────────────────────────────────────

export interface LtvComputationInput {
  userId: string;
  totalOrdersCount: number;
  totalSpendHalire: number;
  firstPurchaseAt: Date | null;
  lastPurchaseAt: Date | null;
  churnProbability: number;
  churnSource: FanLtvScore['churnSource'];
}

export interface LtvComputationResult {
  avgOrderValueHalire: number;
  purchaseFrequencyAnnual: number;
  predictedLifespanYears: number;
  recencyAdjustment: number;
  historicalLtvHalire: number;
  predictedLtvHalire: number;
  ltvSegment: LtvSegment;
}

// ─── Kafka event payloads konzumované SCV ────────────────────────────────────

export interface OrderCompletedForScv {
  orderId: string;
  userId: string;
  promoterId: string;
  eventId: string;
  eventTitle: string;
  eventCategory: string | null;
  ticketTypeId: string | null;
  ticketKind: string | null;
  totalAmountHalire: number;        // haléře — INTEGER
  currency: string;
  occurredAt: string;               // ISO 8601
}

export interface LoyaltyPointsEarnedForScv {
  userId: string;
  points: number;
  newBalance: number;
  newLifetimePoints: number;
  newTier: LoyaltyTier;
  orderId: string;
  occurredAt: string;
}

export interface ChurnScoredForScv {
  userId: string;
  passId: string;
  churnProbability: number;
  predictionHorizon: '7d' | '14d' | '30d';
  computedAt: string;
}

export interface GdprErasureRequestedForScv {
  userId: string;
  requestedAt: string;
  requestId: string;
}

// ─── Service dependencies ─────────────────────────────────────────────────────

export interface ScvServiceDeps {
  db: ScvDbAdapter;
  redis: ScvRedisAdapter;
  kafka: ScvKafkaAdapter;
  logger: ScvLogger;
}

export interface ScvDbAdapter {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  queryOne<T>(sql: string, params?: unknown[]): Promise<T | null>;
  execute(sql: string, params?: unknown[]): Promise<{ rowsAffected: number }>;
  transaction<T>(fn: (tx: ScvDbAdapter) => Promise<T>): Promise<T>;
}

export interface ScvRedisAdapter {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
  del(key: string): Promise<void>;
  mget(keys: string[]): Promise<Array<string | null>>;
}

export interface ScvKafkaAdapter {
  subscribe(topics: string[]): Promise<void>;
  consume(handler: (message: ScvKafkaMessage) => Promise<void>): Promise<void>;
}

export interface ScvKafkaMessage {
  topic: string;
  key: string | null;
  value: unknown;
  offset: string;
  timestamp: string;
}

export interface ScvLogger {
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

// ─── API response shapes ──────────────────────────────────────────────────────

/** Co promotér smí vidět z fan profilu svého zákazníka */
export interface PromoterFanView {
  userId: string;
  // Jen non-sensitive PII pokud fan nakoupil u tohoto promotéra
  firstName: string | null;
  lastName: string | null;
  city: string | null;
  // RFM pro eventy tohoto promotéra (promoter-scoped, ne platform-wide)
  rfmRecencyScore: number | null;
  rfmFrequencyScore: number | null;
  rfmMonetaryScore: number | null;
  rfmSegmentLabel: string | null;
  // Loyalty (jen pokud fan nakoupil u tohoto promotéra)
  loyaltyTier: LoyaltyTier;
  // Churn — jen label, ne přesná hodnota
  churnRiskLabel: 'low' | 'medium' | 'high' | null;
  // Komunikace
  emailOptIn: boolean;
  smsOptIn: boolean;
  pushOptIn: boolean;
  bestSendHour: number | null;
  bestSendDay: number | null;
  // Segmenty (jen promotér-definované)
  segmentIds: string[];
  // Nákupy u tohoto promotéra
  orderCountAtPromoter: number;
  totalSpendAtPromoterHalire: number;
  firstOrderAtPromoter: string | null;
  lastOrderAtPromoter: string | null;
}

// ─── Errors ───────────────────────────────────────────────────────────────────

export class FanProfileNotFoundError extends Error {
  constructor(public readonly userId: string) {
    super(`Fan profile not found: userId=${userId}`);
    this.name = 'FanProfileNotFoundError';
  }
}

export class FanProfileAnonymizedError extends Error {
  constructor(public readonly userId: string) {
    super(`Fan profile has been anonymized (GDPR): userId=${userId}`);
    this.name = 'FanProfileAnonymizedError';
  }
}

export class InsufficientCohortSizeError extends Error {
  constructor(
    public readonly cohortSize: number,
    public readonly minSize: number,
  ) {
    super(`Cohort size ${cohortSize} below minimum ${minSize} for anonymized insights`);
    this.name = 'InsufficientCohortSizeError';
  }
}
```

---

## 11. Kafka event schéma

### Topics konzumované SCV

```typescript
// Kafka topics, které SCV consumer subscribuje:
const SCV_SUBSCRIBED_TOPICS = [
  'order.completed',            // → profiles UPDATE + event_history INSERT
  'order.refunded',             // → profiles UPDATE (total_refunds)
  'loyalty.points_earned',      // → profiles UPDATE (loyalty fields)
  'loyalty.points_redeemed',    // → profiles UPDATE (loyalty_total_points)
  'loyalty.tier_upgraded',      // → profiles UPDATE (loyalty_tier)
  'identity.user_updated',      // → profiles UPDATE (PII fields)
  'identity.user_verified',     // → profiles UPDATE (verification fields)
  'identity.gdpr_erasure',      // → profiles ANONYMIZE + history DELETE
  'ticket.scanned',             // → event_history UPDATE (attended=true)
  'resale.listing_sold',        // → profiles UPDATE (resale_sold_count)
  'resale.purchase_completed',  // → profiles UPDATE + event_history INSERT
  'referral.link_converted',    // → profiles UPDATE (referral_conversions_count)
  'churn.scored',               // → ltv_scores UPSERT (churn_probability)
  'cart.abandoned',             // → profiles UPDATE (cart_abandonment_count)
  'wishlist.item_added',        // → preference_vectors UPDATE
] as const;

// Topics publikované SCV (pro downstream consumption)
const SCV_PUBLISHED_TOPICS = [
  'fan.profile_updated',        // downstream: recommendation-engine, server-side-tracking
  'fan.ltv_segment_changed',    // downstream: re-engagement kampaně, marketing attribution
  'fan.identity_merged',        // downstream: audit log, CS dashboard
] as const;
```

### Partition strategie

Partition key pro SCV consumer = `user_id`. Tím se garantuje:
1. Sekvenční zpracování eventů pro jednoho uživatele (bez race conditions)
2. Ordering je zachován per-user
3. Paralelní zpracování pro různé uživatele (škálovatelnost)

### Consumer group

```
consumer_group = "scv-consumer-v1"
```

Separátní consumer group pro každý downstream systém. SCV consumer nesdílí consumer group s recommendation-engine nebo jinými konzumenty.

---

## 12. Architekturální diagramy

### Datové toky — přehled

```
WRITE SIDE (source of truth)          READ SIDE (SCV)
─────────────────────────────         ───────────────────────────────────

identity.users ─────────────────────► fan.profiles
  (email, phone, name)                (aggregated, denormalized)
  UPDATE event                        < 30s freshness

orders.orders ──────────────────────► fan.profiles (aggregates)
  (order.completed Kafka event)       fan.event_history (detail)
  < 15s freshness

loyalty.accounts ───────────────────► fan.profiles (loyalty fields)
  (loyalty.points_earned)             < 10s freshness

passes.season_passes ───────────────► fan.ltv_scores (churn from passes)
  (churn.scored Kafka, daily 06:00)   < 24h freshness

resale.listings ────────────────────► fan.profiles (resale_*_count)
  (resale.listing_sold)               fan.event_history
  < 30s freshness

segmentation.segments ──────────────► fan.segment_memberships
  (audience-segmentation module)      < 1h freshness

ai.user_features ───────────────────► fan.preference_vectors
  (recommendation-engine)             < 6h freshness

ai.user_send_times ─────────────────► fan.profiles (send_time fields)
  (optimal-send-time module)          < 24h freshness
```

### Multi-promotér datový model

```
                        PLATFORM LEVEL
┌──────────────────────────────────────────────────────────────┐
│  fan.profiles (platform-wide, per-user)                      │
│  fan.ltv_scores (platform-wide LTV)                          │
│  fan.preference_vectors (platform IP)                        │
│  fan.identity_graph (platform-only)                          │
└────────────────────┬─────────────────────────────────────────┘
                     │ RLS filtruje přes promoter_customer_index
              ┌──────┴──────┐
              │             │
    PROMOTER A view     PROMOTER B view
    (jen jejich fani)   (jen jejich fani)
    ┌──────────────┐    ┌──────────────┐
    │ email        │    │ email        │
    │ rfm_score    │    │ rfm_score    │
    │ churn_label  │    │ churn_label  │
    │ loyalty_tier │    │ loyalty_tier │
    │ segments[]   │    │ segments[]   │
    └──────────────┘    └──────────────┘
    (promoter-scoped    (promoter-scoped
     RFM z jejich        RFM z jejich
     eventů)             eventů)
```

---

## 13. Trade-off rozhodnutí

### 1. Event-driven vs. ETL batch pro SCV aktualizace

**Volba:** Primárně event-driven (Kafka), batch jako catch-up + pro složité výpočty (LTV, RFM).

**Argument pro event-driven:** Loyalty balance a základní profil musí být čerstvé — fanoušek vidí svůj loyalty balance v real-time v mobilní aplikaci. ETL batch by způsobil stale data.

**Argument pro batch (LTV/RFM):** LTV výpočet vyžaduje historická data přes celou objednávkovou historii — streaming výpočet by byl příliš drahý pro každou objednávku. Denní batch postačuje pro business rozhodnutí.

**Kompromis:** Kritická data (loyalty, last_purchase) = real-time Kafka. Analytické skóre (LTV, RFM, churn) = denní batch.

### 2. Denormalizovaný fan.profiles vs. normalizované schéma s JOINy

**Volba:** Denormalizovaný `fan.profiles`.

**Argument:** Promotér dashboard a recommendation engine čtou profil desítkytisícekrát za den. JOINy přes 6 schémat (identity, orders, loyalty, passes, resale, segmentation) při každém čtení by zničily výkon. Denormalizace přenáší zátěž na write path (Kafka consumer), ne na read path.

**Cena:** Eventual consistency (data v `fan.profiles` jsou až X sekund za source-of-truth). Akceptovatelné pro analytics use-cases; transakční operace čtou přímo ze zdrojových schémat.

### 3. Promotér-scoped RFM vs. Platform-wide RFM

**Volba:** Oba — platform-wide RFM v `fan.profiles`, promotér-scoped RFM počítán on-demand nebo cachovaný v `fan.promoter_customer_index`.

**Argument:** Platform-wide RFM dává smysl pro platform adminy a recommendation engine. Promotér-scoped RFM dává smysl pro promotéra — "kdo je můj Champion" závisí na objemu jejich eventů, ne celé platformy.

### 4. Probabilistický identity matching — práh confidence

**Volba:** Automatické sloučení pouze pro confidence >= 0.95. Pod 0.95 = manuální review queue pro CS.

**Argument:** False positive identity merge je horší než False negative — nechceme přiřadit nákupy nesprávné osobě, což by mohlo poškodit zákazníka (GDPR compliance, nesprávné personalizace, chybný loyalty balance).

### 5. fan.event_history velikost — retence dat

**Volba:** Neomezená retence (EET compliance pro objednávky; fan history je jen read model kopie).

**Kompromis:** `fan.event_history` může narůst. Partition tabulku dle roku (PostgreSQL table partitioning):

```sql
-- Partitioned by year pro archivaci starých dat
CREATE TABLE fan.event_history (...)
PARTITION BY RANGE (purchased_at);

CREATE TABLE fan.event_history_2024
  PARTITION OF fan.event_history
  FOR VALUES FROM ('2024-01-01') TO ('2025-01-01');
```

---

## 14. Implementační plán pro task #78

### Pořadí implementace

#### Fáze 1 — Základ (den 1-2)

1. **`single-customer-view/src/types/fan.types.ts`** — TypeScript typy (viz sekce 10)
2. **`single-customer-view/migrations/001_fan_schema.sql`** — SQL CREATE TABLE (viz sekce 9)
3. **`single-customer-view/src/lib/db.ts`** — DbAdapter wrapper (stejný pattern jako ostatní moduly)
4. **`single-customer-view/src/lib/kafka.ts`** — KafkaConsumer wrapper

#### Fáze 2 — Kafka consumer (den 2-3)

5. **`single-customer-view/src/consumers/order-completed.consumer.ts`** — nejvyšší priorita, aktualizuje profiles + event_history
6. **`single-customer-view/src/consumers/loyalty-events.consumer.ts`** — body, tier
7. **`single-customer-view/src/consumers/identity-events.consumer.ts`** — PII update + GDPR erasure
8. **`single-customer-view/src/consumers/ticket-scanned.consumer.ts`** — attended flag
9. **`single-customer-view/src/consumers/resale-events.consumer.ts`** — resale counts
10. **`single-customer-view/src/jobs/scv-kafka-consumer.job.ts`** — orchestruje všechny consumers

#### Fáze 3 — Batch joby (den 3-4)

11. **`single-customer-view/src/lib/ltv-calculator.ts`** — LTV výpočetní logika (viz sekce 3)
12. **`single-customer-view/src/lib/rfm-scorer.ts`** — RFM scoring logika
13. **`single-customer-view/src/jobs/ltv-scoring.job.ts`** — cron 07:00, volá ltv-calculator
14. **`single-customer-view/src/jobs/rfm-scoring.job.ts`** — cron 05:00, volá rfm-scorer
15. **`single-customer-view/src/jobs/segment-refresh.job.ts`** — cron 08:00, přepisuje segment_memberships

#### Fáze 4 — Services a API (den 4-5)

16. **`single-customer-view/src/services/fan-profile.service.ts`** — CRUD pro fan.profiles
17. **`single-customer-view/src/services/fan-segment.service.ts`** — segment management
18. **`single-customer-view/src/services/identity-resolution.service.ts`** — matching logika
19. **`single-customer-view/src/app/api/fan/profile/[userId]/route.ts`** — GET fan profilu (buyer + admin)
20. **`single-customer-view/src/app/api/promoter/fans/route.ts`** — GET promoter view (paginated)
21. **`single-customer-view/src/app/api/fan/segments/route.ts`** — GET segmenty

#### Fáze 5 — Integrace (den 5-6)

22. **`single-customer-view/src/services/preference-sync.service.ts`** — sync s recommendation-engine `ai.user_features`
23. **`single-customer-view/src/services/send-time-sync.service.ts`** — sync s optimal-send-time `ai.user_send_times`
24. **`single-customer-view/src/app/api/fan/insights/[genre]/route.ts`** — cross-promotér anonymizované insights (MIN_COHORT = 100)
25. **Vitest testy** pro ltv-calculator, rfm-scorer, consumer logiku

### Závislosti a pořadí

```
fan.types.ts
    └── migrations/001_fan_schema.sql
          └── db.ts + kafka.ts
                └── consumers/*.consumer.ts
                      └── jobs/scv-kafka-consumer.job.ts  ← core
                            │
                            ├── ltv-calculator.ts
                            │       └── jobs/ltv-scoring.job.ts
                            ├── rfm-scorer.ts
                            │       └── jobs/rfm-scoring.job.ts
                            └── jobs/segment-refresh.job.ts
                                      │
                                      └── services/*.service.ts
                                              └── app/api/**
```

### Důležité konvence pro implementaci

- Kafka partition key = `user_id` (sekvenční zpracování per-user)
- Všechny DB writes přes `withTenantContext(db, { role: 'service' }, ...)` pro SCV consumer
- UPSERT pattern: `INSERT ... ON CONFLICT (user_id) DO UPDATE SET ...` pro idempotenci
- Kafka offset ukládán do `fan.profiles.last_kafka_offset` pro at-least-once delivery
- Batch joby musí kontrolovat `updated_at > batch_started_at` — nepřepisovat novější Kafka data
- Všechny peněžní částky v `BIGINT` haléřích — nikdy `FLOAT` nebo `NUMERIC` pro peníze
- `fan.profiles.net_spend_halire` = GENERATED ALWAYS AS — nikdy manuálně nastavovat

---

### Critical Files for Implementation

- `C:/Users/omnia/Documents/tixly/single-customer-view/src/types/fan.types.ts`
- `C:/Users/omnia/Documents/tixly/single-customer-view/migrations/001_fan_schema.sql`
- `C:/Users/omnia/Documents/tixly/single-customer-view/src/jobs/scv-kafka-consumer.job.ts`
- `C:/Users/omnia/Documents/tixly/single-customer-view/src/lib/ltv-calculator.ts`
- `C:/Users/omnia/Documents/tixly/single-customer-view/src/services/fan-profile.service.ts`