# AI Personalizační Engine — Technická architektura

> Claude Opus 4.6 · 4.4.2026

---

## 1. Přehled subsystémů

AI Personalizační Engine je 12. doménová služba platformy Tixly. Běží jako samostatný modul v rámci modulárního monolitu (konzistentně s architekturou z `architecture.md`), komunikuje výhradně přes Kafka eventy (čtení) a REST API (inference).

```
┌─────────────────────────────────────────────────────────────────────┐
│                    AI / Recommendation Service                       │
│                                                                     │
│  ┌──────────────────┐  ┌────────────────────┐  ┌────────────────┐  │
│  │  Recommendation  │  │  Churn Prediction  │  │ Optimal Send   │  │
│  │  Engine          │  │  Engine            │  │ Time Engine    │  │
│  └────────┬─────────┘  └────────┬───────────┘  └───────┬────────┘  │
│           │                     │                       │          │
│  ┌────────▼─────────────────────▼───────────────────────▼────────┐  │
│  │                    Feature Store (PostgreSQL + Redis)          │  │
│  └────────┬──────────────────────────────────────────────────────┘  │
│           │                                                        │
│  ┌────────▼──────────────────────────────────────────────────────┐  │
│  │           Kafka Consumer Group: ai-personalization             │  │
│  │  Topics: OrderCompleted, TicketScannedAtGate,                 │  │
│  │          TicketListedForResale, ResalePurchaseCompleted,       │  │
│  │          PassUsageRecorded, PassRenewalCompleted,              │  │
│  │          PassCancelled, EmailOpened, EmailClicked,             │  │
│  │          PageViewed, SearchPerformed                           │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │         Model Registry (S3-compatible / local filesystem)     │  │
│  └───────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

Tři subsystémy:

| # | Subsystém | Typ modelu | Inference | Latency SLA |
|---|---|---|---|---|
| 1 | Recommendation Engine | Hybrid collaborative + content-based | Pre-computed batch + real-time re-rank | < 50 ms (re-rank), batch 1×/hodina |
| 2 | Churn Prediction | Gradient Boosted Trees (XGBoost) | Batch scoring 1×/den | N/A (async) |
| 3 | Optimal Send Time | Bayesian per-user model | Batch scoring 1×/den | N/A (async) |

---

## 2. Datový model — nové schéma `ai`

Konzistentně s existující architekturou (schema-per-service, cross-schema FK zakázané):

```sql
CREATE SCHEMA IF NOT EXISTS ai;

-- =========================================================================
-- 2.1 Feature Store — předpočítané features per user
-- =========================================================================

CREATE TABLE ai.user_features (
    user_id                 UUID        PRIMARY KEY,
    -- Nákupní profil
    total_purchases         INTEGER     NOT NULL DEFAULT 0,
    total_spend_czk         NUMERIC(12,2) NOT NULL DEFAULT 0,
    avg_ticket_price_czk    NUMERIC(10,2),
    first_purchase_at       TIMESTAMPTZ,
    last_purchase_at        TIMESTAMPTZ,
    purchase_frequency_days NUMERIC(8,2),  -- průměrný interval mezi nákupy
    -- Žánrové preference (top 5 kategorií, normalizované 0–1)
    genre_vector            JSONB       NOT NULL DEFAULT '{}',
    -- Lokace
    primary_city            TEXT,
    avg_venue_distance_km   NUMERIC(8,2),
    -- Cenová citlivost (0 = necitlivý, 1 = velmi citlivý)
    price_sensitivity       NUMERIC(4,3) NOT NULL DEFAULT 0.5,
    -- Engagement
    events_browsed_30d      INTEGER     NOT NULL DEFAULT 0,
    searches_30d            INTEGER     NOT NULL DEFAULT 0,
    emails_opened_30d       INTEGER     NOT NULL DEFAULT 0,
    emails_clicked_30d      INTEGER     NOT NULL DEFAULT 0,
    -- Resale aktivita
    resale_listings_count   INTEGER     NOT NULL DEFAULT 0,
    resale_purchases_count  INTEGER     NOT NULL DEFAULT 0,
    -- Season pass
    has_active_pass         BOOLEAN     NOT NULL DEFAULT FALSE,
    pass_usage_rate         NUMERIC(4,3),  -- využití / kapacita (0–1)
    -- Metadata
    computed_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    feature_version         INTEGER     NOT NULL DEFAULT 1
);

COMMENT ON TABLE ai.user_features IS
    'Předpočítané features per uživatel; aktualizováno batch jobem 1×/hodinu + inkrementálně z Kafka.';

CREATE INDEX idx_ai_user_features_computed_at
    ON ai.user_features (computed_at DESC);

-- =========================================================================
-- 2.2 Feature Store — features per event (pro content-based filtering)
-- =========================================================================

CREATE TABLE ai.event_features (
    event_id                UUID        PRIMARY KEY,
    category                TEXT,
    subcategories           TEXT[],
    venue_city              TEXT,
    venue_capacity          INTEGER,
    base_price_min_czk      NUMERIC(10,2),
    base_price_max_czk      NUMERIC(10,2),
    -- Popularita signály
    total_sold              INTEGER     NOT NULL DEFAULT 0,
    sell_through_rate       NUMERIC(4,3),  -- prodáno / kapacita (0–1)
    sales_velocity_24h      INTEGER     NOT NULL DEFAULT 0,
    resale_listing_count    INTEGER     NOT NULL DEFAULT 0,
    -- Temporal
    days_until_event        INTEGER,
    day_of_week             SMALLINT,   -- 0=Mon, 6=Sun
    month                   SMALLINT,
    is_weekend              BOOLEAN,
    -- Text embedding (pre-computed z title + description)
    title_embedding         REAL[]      NOT NULL DEFAULT '{}',
    -- Metadata
    computed_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE ai.event_features IS
    'Předpočítané features per event; slouží pro content-based filtering a cold start.';

-- =========================================================================
-- 2.3 Pre-computed doporučení (batch output)
-- =========================================================================

CREATE TABLE ai.user_recommendations (
    id                  BIGSERIAL   PRIMARY KEY,
    user_id             UUID        NOT NULL,
    event_id            UUID        NOT NULL,
    score               NUMERIC(6,4) NOT NULL,  -- relevance 0–1
    rank                SMALLINT    NOT NULL,
    -- Explainability — proč doporučujeme
    explanation_key     TEXT        NOT NULL,
    explanation_params  JSONB       NOT NULL DEFAULT '{}',
    model_version       TEXT        NOT NULL,
    computed_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at          TIMESTAMPTZ NOT NULL,

    CONSTRAINT uq_ai_recommendations_user_event
        UNIQUE (user_id, event_id, model_version)
);

COMMENT ON COLUMN ai.user_recommendations.explanation_key IS
    'Klíč pro frontend lokalizaci: genre_match, similar_to_X, location_match, popular_in_cohort, friends_going.';
COMMENT ON COLUMN ai.user_recommendations.explanation_params IS
    'Parametry: {"source_event_title": "Kabát v O2", "genre": "rock"} — frontend sestaví větu.';

CREATE INDEX idx_ai_recommendations_user_id
    ON ai.user_recommendations (user_id, rank ASC)
    WHERE expires_at > NOW();

CREATE INDEX idx_ai_recommendations_event_id
    ON ai.user_recommendations (event_id);

-- =========================================================================
-- 2.4 Churn prediction output
-- =========================================================================

CREATE TABLE ai.churn_predictions (
    id                  BIGSERIAL   PRIMARY KEY,
    pass_id             UUID        NOT NULL,
    user_id             UUID        NOT NULL,
    churn_probability   NUMERIC(4,3) NOT NULL CHECK (churn_probability BETWEEN 0 AND 1),
    -- Top 3 contributing features pro explainability
    top_features        JSONB       NOT NULL DEFAULT '[]',
    model_version       TEXT        NOT NULL,
    prediction_horizon  TEXT        NOT NULL CHECK (prediction_horizon IN ('30d', '14d', '7d')),
    computed_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- Akce
    retention_action    TEXT        CHECK (retention_action IN (
        'none', 'email_discount', 'email_reminder', 'push_highlight', 'phone_call'
    )),
    action_executed_at  TIMESTAMPTZ,
    action_result       TEXT        CHECK (action_result IN ('renewed', 'churned', 'pending'))
);

CREATE INDEX idx_ai_churn_pass_id
    ON ai.churn_predictions (pass_id, prediction_horizon);

CREATE INDEX idx_ai_churn_user_id
    ON ai.churn_predictions (user_id);

CREATE INDEX idx_ai_churn_actionable
    ON ai.churn_predictions (churn_probability DESC)
    WHERE retention_action IS NOT NULL AND action_result = 'pending';

-- =========================================================================
-- 2.5 Optimal send time per user
-- =========================================================================

CREATE TABLE ai.user_send_times (
    user_id             UUID        PRIMARY KEY,
    best_send_hour      SMALLINT    NOT NULL CHECK (best_send_hour BETWEEN 0 AND 23),
    best_send_day       SMALLINT    NOT NULL CHECK (best_send_day BETWEEN 0 AND 6),
    confidence          NUMERIC(4,3) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
    -- Distribuce hodin (pro scheduling flexibility)
    hour_distribution   JSONB       NOT NULL DEFAULT '{}',
    data_points         INTEGER     NOT NULL DEFAULT 0,
    is_cohort_fallback  BOOLEAN     NOT NULL DEFAULT FALSE,
    model_version       TEXT        NOT NULL,
    computed_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON COLUMN ai.user_send_times.hour_distribution IS
    'JSON objekt: {"8": 0.12, "9": 0.18, "10": 0.22, ...} — normalizovaná pravděpodobnost otevření per hodina.';
COMMENT ON COLUMN ai.user_send_times.is_cohort_fallback IS
    'TRUE pokud uživatel nemá dostatek vlastních dat a používáme kohortový průměr.';

-- =========================================================================
-- 2.6 E-mail engagement log (Mailgun webhook sink)
-- =========================================================================

CREATE TABLE ai.email_engagement_log (
    id                  BIGSERIAL   PRIMARY KEY,
    user_id             UUID        NOT NULL,
    message_id          TEXT        NOT NULL,
    event_type          TEXT        NOT NULL CHECK (event_type IN (
        'delivered', 'opened', 'clicked', 'unsubscribed', 'complained'
    )),
    occurred_at         TIMESTAMPTZ NOT NULL,
    -- Temporal features pre-computed
    hour_of_day         SMALLINT    NOT NULL,
    day_of_week         SMALLINT    NOT NULL,
    -- Campaign metadata
    campaign_id         TEXT,
    subject_line        TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ai_email_engagement_user
    ON ai.email_engagement_log (user_id, occurred_at DESC);

CREATE INDEX idx_ai_email_engagement_type
    ON ai.email_engagement_log (event_type, occurred_at DESC);

-- Retention: 12 měsíců, pak archivace do ClickHouse
-- Partition by month v produkci (pg_partman)

-- =========================================================================
-- 2.7 Browsing behavior log (clickstream)
-- =========================================================================

CREATE TABLE ai.browsing_events (
    id                  BIGSERIAL   PRIMARY KEY,
    user_id             UUID,       -- NULL pro anonymní
    session_id          TEXT        NOT NULL,
    event_type          TEXT        NOT NULL CHECK (event_type IN (
        'page_view', 'event_detail_view', 'search', 'add_to_cart', 'purchase'
    )),
    event_id            UUID,       -- NULL pro non-event pages
    search_query        TEXT,       -- NULL pro non-search events
    category_filter     TEXT,
    city_filter         TEXT,
    referrer            TEXT,
    occurred_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ai_browsing_user
    ON ai.browsing_events (user_id, occurred_at DESC)
    WHERE user_id IS NOT NULL;

CREATE INDEX idx_ai_browsing_session
    ON ai.browsing_events (session_id, occurred_at ASC);

-- Retention: 90 dní v PostgreSQL, archivace do ClickHouse
-- Vysoký write volume — partitionovat po týdnech (pg_partman)

-- =========================================================================
-- 2.8 A/B experiment tracking
-- =========================================================================

CREATE TABLE ai.experiments (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT        NOT NULL UNIQUE,
    description     TEXT,
    status          TEXT        NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'running', 'paused', 'completed')),
    variants        JSONB       NOT NULL,  -- [{"id": "control", "weight": 50}, {"id": "treatment_a", "weight": 50}]
    start_at        TIMESTAMPTZ,
    end_at          TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE ai.experiment_assignments (
    id              BIGSERIAL   PRIMARY KEY,
    experiment_id   UUID        NOT NULL REFERENCES ai.experiments (id),
    user_id         UUID        NOT NULL,
    variant_id      TEXT        NOT NULL,
    assigned_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_experiment_user UNIQUE (experiment_id, user_id)
);

CREATE INDEX idx_ai_experiment_assignments_user
    ON ai.experiment_assignments (user_id);

CREATE TABLE ai.experiment_events (
    id              BIGSERIAL   PRIMARY KEY,
    experiment_id   UUID        NOT NULL REFERENCES ai.experiments (id),
    user_id         UUID        NOT NULL,
    variant_id      TEXT        NOT NULL,
    metric_name     TEXT        NOT NULL,   -- 'click', 'purchase', 'revenue_czk'
    metric_value    NUMERIC(12,4) NOT NULL DEFAULT 1,
    occurred_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ai_experiment_events_experiment
    ON ai.experiment_events (experiment_id, metric_name);
```

### Model artifacts storage

Natrénované modely ukládáme jako serializované soubory (joblib/ONNX) do S3-compatible object storage (MinIO v self-hosted, Cloudflare R2 v produkci). Struktura:

```
s3://tixly-models/
  recommendation/
    v1.0.0/
      collaborative_model.onnx
      content_embedder.onnx
      metadata.json          # metrics, training date, data hash
    v1.1.0/
      ...
    latest -> v1.1.0
  churn/
    v1.0.0/
      xgboost_model.json
      feature_importance.json
      metadata.json
    latest -> v1.0.0
  send_time/
    v1.0.0/
      cohort_priors.json     # Bayesian priors per cohort
      metadata.json
    latest -> v1.0.0
```

**Proč ne in-database:** Modely jsou binární artefakty (10–500 MB). PostgreSQL BYTEA by fungoval, ale S3 je levnější, má nativní versioning a CDN pro fast pull do inference workerů.

---

## 3. Feature Engineering

### 3.1 Recommendation Engine — features

| Feature | Zdroj | Výpočet | Freshness |
|---|---|---|---|
| `genre_vector` | OrderCompleted → event category | Batch: normalizovaný histogram kategorií z nákupní historie | 1h |
| `price_sensitivity` | OrderCompleted, browsing | Batch: poměr nákupů v early_bird vs. regular/late fázi + abandon rate na ceně | 1h |
| `primary_city` | OrderCompleted → venue city | Batch: modus měst z posledních 12 měsíců | 1h |
| `purchase_recency` | OrderCompleted timestamp | Streaming: aktualizace `last_purchase_at` při každém OrderCompleted | Real-time |
| `events_browsed_30d` | PageViewed (browsing_events) | Batch: COUNT za 30 dní | 1h |
| `sell_through_rate` (event) | OrderCompleted aggregace | Batch: total_sold / capacity | 5 min |
| `sales_velocity_24h` (event) | OrderCompleted, sliding window | Streaming: Redis HyperLogLog, 24h window | Real-time |
| `title_embedding` (event) | Event title + description | Batch při vytvoření/editaci eventu; Sentence-BERT (multilingual, `paraphrase-multilingual-MiniLM-L12-v2`) | On event create/update |
| `social_signal` | Nákupy přátel (pokud implementován social graph) | Batch: kolik přátel koupilo daný event | 1h |

### 3.2 Churn Prediction — features

| Feature | Výpočet | Proč |
|---|---|---|
| `usage_rate` | pass_usages.count / expected_usages_at_this_point | Klíčový prediktor: kdo málo chodí, ten neprodlouží |
| `usage_gap_trend` | Lineární regrese intervalu mezi posledními 5 návštěvami (slope) | Narůstající gap = churn signal |
| `days_since_last_usage` | NOW() - MAX(pass_usages.used_at) | Recency |
| `remaining_uses_pct` (flex) | remaining_uses / total_uses | Flex pass: kdo nevyčerpal, necítí hodnotu |
| `avg_venue_distance_km` | Haversine(user.primary_city, venue.address) | Daleko bydlící uživatel má vyšší churn risk |
| `support_contacts_count` | Počet support ticketů za dobu platnosti pasu | NPS proxy — nespokojený zákazník |
| `cohort_renewal_rate` | Procento prodloužení v kohortě (stejný pass_type + billing_cycle) | Baseline — je tento uživatel pod/nad průměrem kohorty? |
| `price_change_pct` | (new_price - old_price) / old_price | Zdražení snižuje renewal |
| `months_as_subscriber` | Celková doba předplatného | Loajální zákazník má nižší churn |
| `event_quality_score` | Průměrný sell_through_rate akcí, které mohl navštívit | Špatná nabídka akcí = churn |

### 3.3 Optimal Send Time — features

| Feature | Výpočet | Proč |
|---|---|---|
| `open_hour_histogram` | Histogram hodina → count openů z email_engagement_log | Přímý signál preference |
| `click_hour_histogram` | Histogram hodina → count clicků | Click je silnější signál než open |
| `open_day_histogram` | Histogram den_v_týdnu → count openů | Preferovaný den |
| `device_type` | Nejčastější device z identity.user_devices | Mobilní uživatelé otevírají ráno/večer; desktop přes den |
| `timezone_offset` | Odvozeno z primary_city | Korekce pro non-CZ uživatele (budoucnost: SK expanze) |

### 3.4 Feature pipeline architektura

```
Kafka Topics                         Feature Computation                 Storage
─────────────                        ───────────────────                 ───────

OrderCompleted ──┐
TicketScannedAt ─┤
PassUsageRec ────┤    ┌─────────────────────────┐
ResalePurchase ──┼───▶│ Kafka Consumer Worker    │───▶ Redis (hot features)
PageViewed ──────┤    │ (streaming increments)   │     - sales_velocity_24h
SearchPerformed ─┤    │ Node.js + bullmq         │     - events_browsed_30d (counter)
EmailOpened ─────┤    └─────────────────────────┘     - last_purchase_at
EmailClicked ────┘
                      ┌─────────────────────────┐
        Cron 1×/h ───▶│ Batch Feature Job        │───▶ PostgreSQL ai.user_features
                      │ (Node.js scheduled job)  │     PostgreSQL ai.event_features
                      │ Reads from:              │
                      │  - orders.orders          │
                      │  - tickets.tickets        │
                      │  - catalog.events         │
                      │  - ai.email_engagement    │
                      │  - ai.browsing_events     │
                      └─────────────────────────┘

        Cron 1×/h ───▶ Recommendation batch job ───▶ ai.user_recommendations
        Cron 1×/den ──▶ Churn scoring batch job ───▶ ai.churn_predictions
        Cron 1×/den ──▶ Send time batch job ───────▶ ai.user_send_times
```

**Feature freshness pravidlo:** Features starší než 24 hodin pro recommendation a 48 hodin pro churn jsou stale a musí vyvolat alert. Send time features mohou být staré až 7 dní (chování se mění pomalu).

---

## 4. Model strategie

### 4.1 Recommendation Engine

**Zvolený algoritmus: Hybrid — Alternating Least Squares (ALS) collaborative filtering + content-based re-ranking**

**Proč ALS (collaborative filtering):**
- Implicitní feedback (nákupy, prohlížení) — nemáme explicitní hodnocení (uživatel nehodnotí akce jako u filmů)
- ALS je efektivní na sparse matice (typické pro ticketing: uživatel koupí 2–10 eventů/rok)
- Škáluje na miliony uživatelů (implementace: `implicit` Python knihovna nebo custom TypeScript s ONNX runtime)
- Trade-off: ALS je méně interpretabilní než pure content-based, ale přesnost je významně vyšší

**Proč ne:**
- Deep learning (NCF, Transformers): Overkill pro náš objem dat (řádově tisíce uživatelů v prvním roce). Nasadíme až při > 100k aktivních uživatelů.
- Pure content-based: Nedokáže zachytit "lidé co kupovali X, kupovali taky Y" — tento cross-genre discovery je klíčový pro long-tail events.
- Association rules (Apriori): Příliš hrubé pro personalizaci; vhodné pouze pro "často kupováno spolu" widget.

**Hybrid architektura:**

```
1. ALS candidate generation (offline, batch)
   Input: user-event interaction matrix (purchase=5, view=1, search=0.5)
   Output: top 200 candidate events per user, ranked by predicted preference

2. Content-based re-ranking (online, real-time)
   Input: 200 candidates + user_features + event_features + context (čas, device)
   Re-rank pomocí lightweight scoring:
     score_final = α × als_score
                 + β × genre_similarity(user.genre_vector, event.category)
                 + γ × location_bonus(user.primary_city == event.venue_city)
                 + δ × recency_boost(event.date_start)
                 + ε × price_match(user.price_sensitivity, event.base_price)
                 + ζ × popularity_signal(event.sales_velocity_24h)

   Koeficienty α–ζ optimalizovány přes A/B testy.
   Output: top 20, seřazené, s explanation_key

3. Business rules post-filter (hard constraints)
   - Odfiltruj sold-out eventy
   - Odfiltruj eventy v minulosti
   - Odfiltruj eventy, které uživatel již koupil
   - Boost eventy od organizátorů, kde má uživatel season pass
   - Diversity: max 3 eventy stejné kategorie v top 10
```

**Přetrénování:**
- ALS model: 1x týdně (neděle 03:00). Trigger pro mimořádné přetrénování: > 20% nových uživatelů od posledního tréninku NEBO > 30% nových eventů.
- Content embeddings: při každém event create/update (real-time, Sentence-BERT inference trvá < 100ms per event).
- Re-ranking koeficienty: optimalizovány kontinuálně přes A/B testing framework.

### 4.2 Churn Prediction

**Zvolený algoritmus: XGBoost (Gradient Boosted Decision Trees)**

**Proč XGBoost:**
- Tabulární data (10 features) — XGBoost je prokazatelně nejlepší na tabulární data (benchmarky Kaggle, papers)
- Nativní feature importance → explainability pro business (= proč předpovídáme churn)
- Rychlý trénink (sekundy na tisících řádků) i inference
- Handles missing values nativně (nový uživatel nemá všechny features)
- Výstup je kalibrovaná pravděpodobnost (po Platt scaling)

**Proč ne:**
- Logistická regrese: Méně přesná, ale vysoce interpretabilní. Zvážit jako baseline (v MVP) s přechodem na XGBoost ve fázi 2.
- Neural network: Zbytečné pro 10 features a tisíce vzorků. Overfitting risk.
- Random Forest: Srovnatelný, ale XGBoost typicky o 2–5% lepší AUC na tabulárních datech.

**Rozhodnutí: MVP začne s logistickou regresí (sklearn), fáze 2 přejde na XGBoost. Důvod: logistická regrese je triviální pro audit ("koeficient usage_rate = -2.3 znamená, že nízké využívání silně predikuje churn") a pro tým < 15 lidí je transparentnost důležitější než marginální zlepšení přesnosti.**

**Scoring schedule:**
- 30 dní před expirací: první scoring. Pokud `churn_probability > 0.6` → trigger `email_reminder` s personalizovaným obsahem (nadcházející akce, kterých by přišel)
- 14 dní: re-scoring. Pokud `churn_probability > 0.7` → trigger `email_discount` (5–10% sleva na prodloužení)
- 7 dní: finální scoring. Pokud `churn_probability > 0.8` → trigger `push_highlight` + volitelně `phone_call` (premium pasy)

**Přetrénování:** Měsíčně. Trigger: data drift detekce (PSI > 0.2 na libovolném feature).

### 4.3 Optimal Send Time

**Zvolený algoritmus: Bayesian conjugate model (Beta-Binomial per hodina)**

**Jak to funguje:**
1. Prior: kohortový průměr (uživatelé se stejným `device_type` + `primary_city`). Kódovaný jako Beta(α₀, β₀) per hodina.
2. Likelihood: individuální open/click data uživatele. Každý open v hodině H → pozorování = 1, každý delivered-but-not-opened v hodině H → pozorování = 0.
3. Posterior: Beta(α₀ + opens_H, β₀ + deliveries_H - opens_H) per hodina.
4. Output: hodina s nejvyšším posteriorem E[θ_H] = (α₀ + opens_H) / (α₀ + β₀ + deliveries_H).

**Proč Bayesian:**
- Elegantní cold start: při 0 datech → prior = kohortový průměr. S každým datapointem se model automaticky posouvá k individuální preferenci.
- Žádné přetrénování potřeba — model se aktualizuje inkrementálně s každým novým e-mailem.
- Confidence interval zdarma: pokud σ je vysoká, víme že máme málo dat a můžeme fallbacknout na kohortu.
- Žádný heavy ML framework potřeba — výpočet je analytický (10 řádků kódu).

**Proč ne:**
- Neuronová síť (LSTM na časové řady): Masivní overkill, potřebuje tisíce datapointů per user. My máme 2–10 e-mailů/měsíc.
- Frequency-based (modus hodiny openů): Nestabilní při malém počtu pozorování. Bayesian přístup konverguje správně.

**Cold start threshold:** Pokud uživatel má < 5 e-mail interakcí → `is_cohort_fallback = TRUE`, confidence < 0.3.

**Přetrénování:** Není potřeba. Model se aktualizuje analyticky. Kohortové priory se přepočítávají 1x/měsíc.

---

## 5. Cold Start Problem — konkrétní řešení

### 5.1 Nový uživatel (0 nákupů)

**Fáze 1 — Onboarding (0 interakcí):**
- Při registraci: volitelný "Jaké akce tě zajímají?" — 3–5 kategorií (koncerty, divadlo, sport, festivaly, stand-up). Prezentováno jako kartičky, ne povinný formulář.
- Pokud uživatel přeskočí: popularity-based ranking (nejprodávanější v jeho městě za posledních 30 dní). Město odvozeno z IP geolokace (Cloudflare CF-IPCity header).
- Explanation: "Populární ve tvém městě" / "Novinky na Tixly"

**Fáze 2 — Partial signal (1–3 interakce: prohlížení, search):**
- Content-based matching: pokud si prohlédl rockový koncert → boost rock events.
- Search query analysis: "divadlo Brno" → category=divadlo, city=Brno → content filter.
- Session-based: "uživatelé co si prohlédli tento event, prohlédli taky..." (item-item similarity z ALS modelu, nevyžaduje user profil).

**Fáze 3 — First purchase (1+ nákupů):**
- Plný hybrid model se zapne. ALS potřebuje min. 1 interakci pro embedding.

**Rozhodnutí:** Nepodmiňujeme registraci onboarding dotazníkem. Engagement rate "přeskoč" tlačítka je typicky 60–70%. Popularity fallback funguje dobře pro hlavní český trh (Praha, Brno, Ostrava pokrývají 80%+ poptávky).

### 5.2 Nová akce (0 prodejů)

**Content-based injection:**
1. Při vytvoření eventu: Sentence-BERT embedding z title + description → `ai.event_features.title_embedding`.
2. Cosine similarity s existujícími eventy → zařadit do clusteru podobných akcí.
3. Pokud je event kategorie=rock a venue=O2 Arena → zdědí audience profil z předchozích rock eventů v O2 Areně.

**Exploration bonus:**
- Nové eventy (vytvořené v posledních 7 dnech) dostávají exploration boost v re-ranking fázi: `score += 0.15 × (1 - days_since_creation/7)`.
- Boost klesá lineárně a po 7 dnech zmizí → event musí obstát na vlastních meritách.

**Organizátor boost:**
- Pokud má uživatel season pass u organizátora, který vytvořil nový event → automaticky v top 5 doporučení.
- Explanation: "Nová akce od tvého oblíbeného organizátora"

**Long-tail events (malá kapacita, niche žánr):**
- Problém: ALS collaborative filtering tyto eventy ignoruje (málo interakcí).
- Řešení: Content-based filtering pokrývá long-tail. Sentence-BERT embedding zachytí sémantickou podobnost i bez historických dat.
- Dodatečně: "Skrytý klenot" widget — náhodný výběr z long-tail eventů s vysokým content-match score ale nízkým ALS score. Diversifikace feedu.

---

## 6. Inference architektura

### 6.1 Recommendation — hybrid batch + real-time

```
┌────────────┐     ┌─────────────────────┐     ┌──────────────┐
│ Batch Job  │────▶│ ai.user_             │────▶│ Redis Cache  │
│ (1×/hodinu)│     │ recommendations      │     │ TTL 60 min   │
│ ALS top 200│     │ (PostgreSQL)         │     │ per user     │
└────────────┘     └─────────────────────┘     └──────┬───────┘
                                                       │
                                                       ▼
                   ┌──────────────────────────────────────────┐
                   │  GET /api/recommendations?limit=10       │
                   │  1. Read from Redis (hit? → re-rank)     │
                   │  2. Miss? Read from PostgreSQL            │
                   │  3. Apply real-time re-ranking            │
                   │     (context: time, device, recent views) │
                   │  4. Apply business rules post-filter      │
                   │  5. Attach explanation                    │
                   │  6. Return top N                          │
                   │  Latency budget: 50 ms                    │
                   └──────────────────────────────────────────┘
```

**Latency breakdown:**
- Redis read: 1–3 ms
- Re-ranking (in-memory scoring, 200 candidates): 5–10 ms
- Business rules filter: 2–5 ms
- PostgreSQL fallback (cache miss): 15–30 ms
- **Total: < 50 ms** (P99)

**Caching strategie:**
- Redis key: `reco:{user_id}:{model_version}`
- Value: JSON array of top 200 candidates s pre-computed ALS scores
- TTL: 60 minut (shodný s batch frequency)
- Invalidation: při OrderCompleted eventu pro daného uživatele → delete key → next request triggers fresh re-rank

### 6.2 Churn Prediction — pure batch

```
┌──────────────────┐     ┌──────────────────────┐
│ Daily Job 06:00  │────▶│ ai.churn_predictions │
│ Score all active │     │ (PostgreSQL)          │
│ passes expiring  │     └──────────┬────────────┘
│ within 30 days   │                │
└──────────────────┘                ▼
                         ┌──────────────────────┐
                         │ Kafka: ChurnScored    │
                         │ Consumer: Marketing   │
                         │ → trigger campaign    │
                         └──────────────────────┘
```

Žádný real-time inference. Batch job běží jednou denně. Výsledky konzumuje Marketing & CRM Service přes Kafka event `ChurnScored` s payloadem `{pass_id, user_id, churn_probability, retention_action}`.

### 6.3 Optimal Send Time — lookup at send time

Marketing Service při schedulování kampaně:
1. Query `ai.user_send_times` pro všechny cílové uživatele.
2. Seskupí uživatele dle `best_send_hour`.
3. Naplánuje odeslání v příslušných hodinách (Mailgun scheduled send).

```
Marketing Service                    AI Service
    │                                    │
    │  GET /api/ai/send-times            │
    │  ?user_ids=uuid1,uuid2,...         │
    │───────────────────────────────────▶│
    │                                    │ Read from ai.user_send_times
    │  [{userId, bestHour, bestDay,      │
    │    confidence}]                     │
    │◀───────────────────────────────────│
    │                                    │
    │  Schedule emails per hour bucket   │
    │                                    │
```

**Batch endpoint:** Pro kampaně s > 1000 příjemců: `POST /api/ai/send-times/batch` s body `{user_ids: [...]}`. Response streamovaná jako NDJSON.

---

## 7. Privacy a GDPR

### 7.1 Právní základ pro personalizaci

| Data | Právní základ | Odůvodnění |
|---|---|---|
| Nákupní historie (pro doporučení) | Oprávněný zájem (čl. 6(1)(f)) | Zlepšení uživatelského zážitku; uživatel rozumně očekává personalizaci od ticketingové platformy |
| Browsing behavior | Souhlas (čl. 6(1)(a)) | Tracking chování na webu vyžaduje cookie consent; bez souhlasu → popularity fallback |
| E-mail engagement (open/click) | Oprávněný zájem (čl. 6(1)(f)) | Optimalizace doby odesílání je legitimní zájem; uživatel profituje z relevantního načasování |
| Churn prediction (pass usage data) | Plnění smlouvy (čl. 6(1)(b)) | Analýza využívání zakoupené služby pro zlepšení nabídky |
| Geolokace (město z IP) | Oprávněný zájem (čl. 6(1)(f)) | Pouze město-level, ne přesná poloha; nezbytné pro lokální doporučení |

### 7.2 Opt-out mechanismus

```
Nastavení profilu → Personalizace
  ☑ Personalizovaná doporučení akcí
  ☑ Optimální čas doručení e-mailů
  ☑ Analýza využívání permanentky

  [Vypnout veškerou personalizaci]
```

**Technická implementace:**
- `identity.users` rozšířit o `personalization_consent JSONB DEFAULT '{"recommendations": true, "send_time": true, "churn_analysis": true}'`
- Kafka consumer při zpracování eventu kontroluje consent PŘED zápisem do ai.* tabulek
- Při opt-out: smazat všechny záznamy v `ai.user_features`, `ai.user_recommendations`, `ai.user_send_times` pro daného uživatele (hard delete, ne soft)
- Doporučení pro opt-out uživatele: popularity-based fallback (neindividualizované)

### 7.3 Data minimization

- `ai.browsing_events`: retention 90 dní, pak hard delete (agregované features v `ai.user_features` zůstávají)
- `ai.email_engagement_log`: retention 12 měsíců, pak hard delete
- `ai.user_features`: aktualizovány in-place (no history), smazány při GDPR erasure
- Raw Kafka events: Kafka retention 30 dní (po zpracování do feature store nepotřebujeme raw data)
- **Nikdy neukládáme:** obsah e-mailů, plné URL s query parametry, přesnou GPS polohu

### 7.4 Propagace GDPR výmazu

Existující `user.deleted` Kafka event (viz `security-model.md` sekce 5) → AI Service consumer:
1. `DELETE FROM ai.user_features WHERE user_id = :uid`
2. `DELETE FROM ai.user_recommendations WHERE user_id = :uid`
3. `DELETE FROM ai.user_send_times WHERE user_id = :uid`
4. `DELETE FROM ai.churn_predictions WHERE user_id = :uid`
5. `DELETE FROM ai.email_engagement_log WHERE user_id = :uid`
6. `DELETE FROM ai.browsing_events WHERE user_id = :uid`
7. `DELETE FROM ai.experiment_assignments WHERE user_id = :uid`
8. Emit `ai.user_data_deleted` event (pro audit)

---

## 8. Monitoring

### 8.1 Business metriky (ne ML metriky)

| Metrika | Jak měříme | Cíl |
|---|---|---|
| **Recommendation CTR** | Klik na doporučenou akci / zobrazení widgetu | > 5% |
| **Recommendation conversion rate** | Nákup z doporučení / zobrazení | > 0.5% |
| **Incremental revenue from reco** | Revenue z nákupů atribuovaných doporučení vs. control group | > 10% uplift |
| **Churn prediction precision@0.7** | Z uživatelů se score > 0.7, kolik skutečně churnovalo | > 70% |
| **Retention campaign ROI** | Revenue z prodloužených pasů po kampani / náklady kampaně | > 3x |
| **Send time uplift** | Open rate personalizovaný čas vs. control (fixní 10:00) | > 15% relativní uplift |
| **Opt-out rate** | % uživatelů kteří vypnou personalizaci | < 5% (vyšší = UX problém) |

### 8.2 ML metriky (operační)

| Metrika | Threshold pro alert |
|---|---|
| ALS model AUC (offline eval) | < 0.65 (degradace) |
| Churn model AUC | < 0.70 |
| Feature staleness | user_features.computed_at > 24h pro > 10% uživatelů |
| Recommendation coverage | < 50% aktivních eventů se objeví v alespoň 1 doporučení |
| Prediction latency P99 | > 100ms (recommendation API) |
| Batch job duration | > 2h (recommendation), > 30min (churn/send_time) |
| Feature drift (PSI) | > 0.2 na libovolném feature |

### 8.3 A/B Testing Framework

**Design:**
- Deterministické přiřazení: `variant = hash(experiment_id + user_id) % 100`. Konzistentní — uživatel vidí stejnou variantu po celou dobu experimentu.
- Minimální sample size kalkulátor: před startem experimentu → kolik uživatelů potřebujeme pro statistickou signifikanci (power = 0.8, alpha = 0.05).
- Guardrail metriky: pokud treatment varianta sníží celkovou conversion rate o > 5%, experiment se automaticky zastaví.

**Typické experimenty:**
1. `reco_diversity`: control (max 5 stejných kategorií) vs. treatment (max 3) → měříme CTR + conversion
2. `reco_explanation`: control (bez vysvětlení) vs. treatment ("Protože jsi byl na Kabát") → měříme CTR
3. `churn_discount_level`: 5% vs. 10% sleva pro churn-risk uživatele → měříme retention + revenue
4. `send_time_personalized`: control (10:00 fixně) vs. treatment (personalizovaný čas) → měříme open rate

**Statistická metoda:** Bayesian A/B testing (conjugate Beta-Binomial pro conversion metriky). Nepotřebujeme fixed horizon — Bayesian přístup umožňuje "peek" bez inflace false positive rate.

### 8.4 Model degradation detection

Automatický pipeline po každém batch scoring:
1. Porovnej distribuci `churn_probability` s předchozím scoringem → PSI test
2. Porovnej feature distribuce s trénovacími daty → PSI test per feature
3. Pokud PSI > 0.2 → Slack alert + automatický re-training trigger
4. Pokud PSI > 0.5 → rollback na předchozí model verzi + P1 alert

---

## 9. Transparentnost doporučení — "Proč ti to doporučujeme"

Každé doporučení má `explanation_key` + `explanation_params`. Frontend mapuje na lokalizované věty:

| `explanation_key` | Template (CZ) | Příklad |
|---|---|---|
| `genre_match` | "Protože máš rád/a {genre}" | "Protože máš rád/a rock" |
| `similar_to_event` | "Podobné akci {event_title}, na které jsi byl/a" | "Podobné akci Kabát v O2 Areně" |
| `location_match` | "Akce ve tvém městě {city}" | "Akce ve tvém městě Praha" |
| `popular_in_city` | "Populární v {city}" | "Populární v Brně" |
| `organizer_pass` | "Nová akce od tvého organizátora {organizer}" | "Nová akce od Divadla Na Vinohradech" |
| `friends_going` | "{count} tvých přátel jde" | "3 tvoji přátelé jdou" |
| `trending` | "Rychle se vyprodává" | "Rychle se vyprodává" |
| `hidden_gem` | "Tip od Ticketaria" | "Tip od Ticketaria" |
| `new_event` | "Nově přidaná akce" | "Nově přidaná akce" |

**Pravidlo:** Každé doporučení MUSÍ mít alespoň jednu vysvětlující větu. Pokud nemáme specifický důvod (cold start), použijeme `popular_in_city` nebo `new_event`.

---

## 10. API kontrakty

### 10.1 Recommendation API

```
GET /api/ai/recommendations
Query params:
  limit=10          (default 10, max 50)
  category=rock     (optional filter)
  city=Praha        (optional filter)

Headers:
  Authorization: Bearer <jwt>

Response 200:
{
  "recommendations": [
    {
      "eventId": "uuid",
      "score": 0.87,
      "rank": 1,
      "explanation": "Protože máš rád/a rock",
      "explanationKey": "genre_match",
      "explanationParams": {"genre": "rock"}
    },
    ...
  ],
  "modelVersion": "v1.2.0",
  "personalized": true,         // false pro opt-out / cold start
  "computedAt": "2026-04-04T10:00:00Z"
}

Response 200 (opt-out uživatel):
{
  "recommendations": [...],
  "modelVersion": "popularity_v1",
  "personalized": false,
  "computedAt": "2026-04-04T10:00:00Z"
}
```

### 10.2 Churn API (interní — Marketing Service volá)

```
GET /api/ai/churn/actionable
Query params:
  min_probability=0.6
  horizon=14d

Response 200:
{
  "predictions": [
    {
      "passId": "uuid",
      "userId": "uuid",
      "churnProbability": 0.78,
      "topFeatures": [
        {"name": "usage_rate", "value": 0.2, "impact": "high"},
        {"name": "days_since_last_usage", "value": 45, "impact": "medium"}
      ],
      "recommendedAction": "email_discount",
      "predictionHorizon": "14d"
    },
    ...
  ]
}
```

### 10.3 Send Time API (interní)

```
POST /api/ai/send-times/batch
Body:
{
  "userIds": ["uuid1", "uuid2", ...]
}

Response 200:
{
  "sendTimes": [
    {
      "userId": "uuid1",
      "bestSendHour": 9,
      "bestSendDay": 2,      // Wednesday
      "confidence": 0.72,
      "isCohortFallback": false
    },
    ...
  ]
}
```

---

## 11. Implementační pořadí

### MVP (měsíc 11–12)

**Cíl: fungující doporučení s popularity fallbackem + základní churn alerting**

1. **PostgreSQL schéma `ai`** — všechny tabulky z sekce 2
2. **Kafka consumer** — konzumuje OrderCompleted, PageViewed → plní `ai.browsing_events`, inkrementuje counters
3. **Batch feature job** — 1×/hodinu počítá `ai.user_features` a `ai.event_features`
4. **Popularity-based recommendation** — ŽÁDNÝ ML model. Jednoduše: top eventy dle `sales_velocity_24h` × `genre_match_bonus`. Uložit do `ai.user_recommendations`.
5. **Recommendation API** — `GET /api/ai/recommendations` s Redis cache
6. **Explanation system** — `popular_in_city`, `genre_match`, `new_event`
7. **Churn scoring v1** — logistická regrese (5 features: usage_rate, days_since_last_usage, usage_gap_trend, cohort_renewal_rate, months_as_subscriber). Score zapsán do `ai.churn_predictions`.
8. **Churn → Marketing trigger** — Kafka event `ChurnScored` → Marketing Service pošle retention e-mail
9. **GDPR plumbing** — opt-out toggle, `user.deleted` consumer, data retention jobs
10. **Basic monitoring** — recommendation CTR tracking, churn precision monitoring

**Co MVP NEMÁ:**
- ALS collaborative filtering (popularity-based je dostatečný pro < 10k uživatelů)
- Optimal send time (fixní 10:00 pro všechny)
- A/B testing framework
- Sentence-BERT embeddings
- Real-time re-ranking

### Fáze 2 (měsíc 13–15)

**Cíl: plný ML stack, personalizace na individuální úrovni**

1. **ALS collaborative filtering** — trénink na nákupní matici, batch 1×/týden
2. **Sentence-BERT embeddings** — `paraphrase-multilingual-MiniLM-L12-v2` pro event title/description
3. **Real-time re-ranking** — lightweight scoring vrstva s kontextem (čas, device)
4. **Optimal Send Time** — Bayesian model, Mailgun webhook integrace, `ai.email_engagement_log`
5. **A/B testing framework** — `ai.experiments`, deterministické přiřazení, Bayesian evaluation
6. **XGBoost churn model** — nahradí logistickou regresi, 10 features
7. **Exploration bonus** pro nové eventy
8. **Diversity constraint** v doporučeních (max 3 per kategorie)

### Fáze 3 (měsíc 16+, backlog)

1. **Social graph** — "přátelé jdou na..." (vyžaduje social features v identity service)
2. **Deep learning recommendation** — NCF nebo Two-Tower model při > 100k uživatelů
3. **Multi-armed bandit** pro real-time exploration vs. exploitation
4. **Propensity-to-buy scoring** — per user × per event
5. **Dynamic pricing integration** — AI doporučuje optimální cenu (vyžaduje regulatorní review)
6. **Cross-sell model** — doporučení merchandise, F&B balíčků k vstupence
7. **ClickHouse migration** pro `ai.browsing_events` a `ai.email_engagement_log` (PostgreSQL nestačí při > 1M events/den)

---

## 12. Sezonalita a temporal patterns

Český ticketing trh má výraznou sezonalitu:
- **Léto (červen–srpen):** festivaly, open-air koncerty — peak poptávka
- **Prosinec:** vánoční koncerty, dárkové vstupenky — druhý peak
- **Leden–únor:** low season — divadlo a indoor eventy dominují

**Dopad na modely:**
- ALS model: trénovat na posledních 12 měsících dat (ne jen 3 měsíce — jinak ztratíme sezónní vzorce)
- Popularity ranking: season-aware — v květnu boostovat letní eventy, v listopadu vánoční
- Churn prediction: usage_rate normalizovat na sezónu (permanentkář divadla logicky méně chodí v létě → to není churn signal)
- Feature: `is_holiday_season` (14 dní před Vánoci) → boost konverzních predikcí

---

## 13. Infrastrukturní závislosti

| Závislost | Účel v AI service | Stávající/nová |
|---|---|---|
| PostgreSQL (schéma `ai`) | Feature store, prediction output, experiments | Nové schéma ve stávajícím clusteru |
| Redis | Cache doporučení, real-time counters (sales velocity) | Stávající Redis cluster |
| Kafka | Konzumace doménových eventů, emitování ChurnScored | Stávající Kafka cluster |
| S3/MinIO/R2 | Model artifacts storage | Nová (R2 v produkci, lokální filesystem v dev) |
| Python runtime | Trénink ML modelů (sklearn, xgboost, implicit, sentence-transformers) | Nová — separátní container pro training jobs |
| ONNX Runtime | Inference serializovaných modelů v Node.js | Nová npm dependency (`onnxruntime-node`) |

**Rozhodnutí: trénink v Pythonu, inference v Node.js (ONNX)**

Proč: Celá platforma je Node.js/TypeScript. Inference přes ONNX Runtime Node.js binding eliminuje potřebu Python microservice pro serving. Python se používá POUZE pro offline trénink (scheduled jobs v Docker kontejneru). Toto zjednodušuje deployment a udržuje konzistenci s existující architekturou.

---

## 14. Souhrn klíčových rozhodnutí

| Rozhodnutí | Volba | Důvod |
|---|---|---|
| Recommendation algoritmus | ALS + content-based re-ranking (hybrid) | ALS zachycuje collaborative patterns; content-based řeší cold start a long-tail |
| Churn model MVP | Logistická regrese → XGBoost ve fázi 2 | Transparentnost a auditovatelnost pro malý tým |
| Send time model | Bayesian Beta-Binomial | Nativní cold start řešení, inkrementální update, žádný heavy framework |
| Feature store | PostgreSQL + Redis | Konzistentní s existující architekturou; žádný nový infra component (Feast/Tecton jsou overkill) |
| Model serving | ONNX Runtime v Node.js | Žádný Python microservice pro inference; konzistence se stackem |
| Cold start (uživatel) | Popularity fallback → onboarding preference → partial signal → full model | Progresivní personalizace bez vynucení onboardingu |
| Cold start (event) | Content embedding + exploration bonus + organizátor boost | Nový event má šanci bez historických dat |
| Explainability | explanation_key + params na každém doporučení | Transparentnost jako USP vs. Ticketmaster black box |
| GDPR | Opt-out per subsystém, hard delete při opt-out/erasure | Nadstandardní compliance — budování důvěry |
| A/B testing | Bayesian evaluation, deterministické přiřazení | Bez fixed horizon, peek-safe |
| MVP scope | Popularity-based reco + logistic regression churn | Maximální dopad s minimální ML komplexitou |
