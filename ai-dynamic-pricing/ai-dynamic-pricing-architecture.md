# AI Dynamic Pricing — Kompletní architektonický dokument

## Task #72 — Opus-level návrh | Tixly | 2026-04-06

---

## 0. Shrnutí rozhodnutí

| Oblast | Rozhodnutí | Zdůvodnění |
|---|---|---|
| Model algoritmus | Hybrid: rule-based guardrails + weighted demand score | Vysvětlitelné, auditovatelné, bez potřeby labeled training data pro start |
| Frekvence update | 5 minut (konfigurovatelné per event, min 1 min, max 60 min) | Trade-off: Redis TTL 60s uz existuje; 5 min = reaktivní bez UX šoku |
| Koexistence s fázemi | Dynamic pricing jako `override` uvnitř fázové ceny — fáze setuje `phasePrice`, dynamic engine počítá finální cenu uvnitř guardrails | Zero breaking change na existující `PricingService` |
| Frontend real-time | Polling každých 30s (již implementováno v `PriceDisplay.tsx`) — rozšíříme o SSE pro burst prodeje | Polling je robustní; SSE přidáme jako opt-in pro high-demand eventy |
| A/B testování | Bucket hash na `session_id`, ne na `user_id` — řeší price discrimination | Session-based = anonymní, splňuje GDPR |
| Cold start | Similarity matching na `ai.event_features` (již existuje) + konzervativní default křivka | Využíváme existující infrastrukturu z `ai-personalization` modulu |
| Datové schéma | Nové schéma `pricing` oddělené od `catalog` | Schema-per-service konvence platformy |

---

## 1. Demand-based dynamic pricing model

### 1.1 Feature vector (vstupy cenového modelu)

Cena se počítá z pěti skupin features, každá normalizovaná na `[0.0, 1.0]`:

```
DemandScore = w1·velocity_score
            + w2·capacity_score
            + w3·time_pressure_score
            + w4·historical_score
            + w5·external_score
```

Výchozí váhy (konfigurovatelné per event v `event_price_config`):

| Feature skupina | Váha výchozí | Popis |
|---|---|---|
| `velocity_score` | 0.35 | Rychlost prodeje — klíčový signál |
| `capacity_score` | 0.30 | Zbývající kapacita |
| `time_pressure_score` | 0.20 | Blízkost eventu |
| `historical_score` | 0.10 | Srovnání s podobnými eventy |
| `external_score` | 0.05 | Svátky, konkurence (optional) |

#### Velocity score

Měří zrychlení/zpomalení prodeje vůči historickému průměru:

```typescript
// Pseudokód výpočtu velocity_score
function computeVelocityScore(signals: DemandSignal[], windowMinutes: number): number {
  const recentWindow = signals.filter(s => s.recorded_at >= now - windowMinutes * 60_000);
  const olderWindow = signals.filter(s =>
    s.recorded_at >= now - 2 * windowMinutes * 60_000 &&
    s.recorded_at < now - windowMinutes * 60_000
  );

  const recentSales = recentWindow.at(-1)?.cumulative_sold ?? 0 - recentWindow.at(0)?.cumulative_sold ?? 0;
  const olderSales = olderWindow.at(-1)?.cumulative_sold ?? 0 - olderWindow.at(0)?.cumulative_sold ?? 0;

  // Acceleration ratio: > 1 = zrychluje, < 1 = zpomaluje
  const ratio = olderSales === 0 ? (recentSales > 0 ? 2.0 : 0.5) : recentSales / olderSales;

  // Normalizovat: ratio 0.5–3.0 → score 0–1
  return Math.min(1.0, Math.max(0.0, (ratio - 0.5) / 2.5));
}
```

#### Capacity score

Nelineární — zdražení akceleruje v posledních 20% kapacity:

```typescript
function computeCapacityScore(soldPct: number): number {
  // Sigmoid-like curve: pomalý růst 0–60%, strmý 60–100%
  if (soldPct < 0.6) return soldPct * 0.5;           // 0 → 0.30
  if (soldPct < 0.8) return 0.3 + (soldPct - 0.6) * 1.5;  // 0.30 → 0.60
  return 0.6 + (soldPct - 0.8) * 2.0;               // 0.60 → 1.00
}
```

#### Time pressure score

```typescript
function computeTimePressureScore(hoursToEvent: number): number {
  if (hoursToEvent > 720) return 0.0;   // > 30 dní: žádný tlak
  if (hoursToEvent > 168) return 0.1;   // 7–30 dní: nízký
  if (hoursToEvent > 72)  return 0.3;   // 3–7 dní: střední
  if (hoursToEvent > 24)  return 0.6;   // 1–3 dny: vysoký
  if (hoursToEvent > 6)   return 0.85;  // 6–24 h: velmi vysoký
  return 1.0;                           // < 6 h: maximální
}
```

#### Historical score

Srovnáváme aktuální `sell_through_rate` s mediánem podobných eventů ve stejném stadiu:

```typescript
function computeHistoricalScore(
  currentSellThrough: number,
  similarEventMedian: number,   // z ai.event_features
): number {
  if (similarEventMedian === 0) return 0.5; // cold start fallback
  const ratio = currentSellThrough / similarEventMedian;
  return Math.min(1.0, Math.max(0.0, (ratio - 0.5) / 1.5));
}
```

#### External score (optional, výchozí vypnuto)

- Státní svátek v den eventu: `+0.15` (méně konkurentů, jiný dopravní pattern)
- Konkurenční event ve stejném městě ve stejný den: `-0.10`
- Špatné předpovědi počasí (venkovní event): `-0.20`

Implementováno jako `JSONB external_factors` v `event_price_config` — promotér vyplní ručně nebo přes budoucí API integraci.

---

### 1.2 Výsledný cenový multiplikátor

```typescript
function computePriceMultiplier(
  demandScore: number,  // 0.0–1.0
  config: EventPriceConfig,
): number {
  // Lineární interpolace mezi min_multiplier a max_multiplier
  // min_multiplier typicky 1.0 (cena nemůže klesnout pod fázovou cenu)
  // max_multiplier typicky 1.5–2.0 (dle nastavení promotéra)
  const raw = config.min_multiplier + (config.max_multiplier - config.min_multiplier) * demandScore;

  // Guardrail: zaokrouhlit na nejbližších 10 Kč výše (1000 haléřů) — psychologická cena
  return raw;
}

function applyMultiplierToPrice(
  phasePrice: INTEGER,  // halíře
  multiplier: number,
  config: EventPriceConfig,
): INTEGER {
  const raw = Math.ceil((phasePrice * multiplier) / 1000) * 1000;

  // Guardrails
  const minPrice = config.min_price_override ?? phasePrice; // nikdy pod fázovou cenu
  const maxPrice = config.max_price_halire;                 // absolutní strop

  // Max change per cycle guardrail
  const maxIncrease = Math.floor(phasePrice * (1 + config.max_change_per_cycle_pct / 100));
  const maxDecrease = Math.ceil(phasePrice * (1 - config.max_change_per_cycle_pct / 100));

  return Math.max(minPrice, Math.min(maxPrice, Math.min(maxIncrease, Math.max(maxDecrease, raw))));
}
```

### 1.3 Guardrails — povinné

| Guardrail | Implementace | Hodnota |
|---|---|---|
| Cenový strop | `max_price_halire` v `event_price_config` | Promotér nastaví při konfiguraci |
| Cenový spodek | `min_price_override ?? phasePrice` | Nesmí klesnout pod aktuální fázovou cenu |
| Max. změna za cyklus | `max_change_per_cycle_pct` | Default 20%, konfigurovatelné 0–50% |
| Frekvence update | `update_interval_minutes` | Default 5 min, min 1 min, max 60 min |
| Kill switch | `dynamic_pricing_enabled: boolean` | Per event — okamžité vypnutí |

### 1.4 Frekvence aktualizace cen — rozhodnutí

Zvoleno **5 minut** jako výchozí s tímto zdůvodněním:

- Redis TTL je 60s — update každých 5 min = cache se za jeden cyklus obnoví 5×, dostatečně
- `PhaseCheckerJob` běží každou minutu — dynamic pricing job bude paralelní job, ne stejný interval
- UX dopad: zákazník vidí v `PriceDisplay.tsx` polling každých 30s — změna každých 5 min = zobrazí se při příštím pollu, žádný šok
- Pro sell-out eventy (>80% sold): interval se automaticky zkrátí na 1 minutu (emergency mode v configu)

---

## 2. Datový model — schéma `pricing`

### 2.1 SQL schéma

```sql
-- =============================================================================
-- SCHÉMA: pricing
-- Zodpovědnost: dynamic pricing engine, demand signály, A/B experimenty
-- Konzistentní s platformovou konvencí: schema-per-service, cross-schema FK zakázané
-- Ceny: INTEGER halíře (1 Kč = 100 haléřů). Nikdy FLOAT ani NUMERIC pro peníze.
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS pricing;

-- ---------------------------------------------------------------------------
-- 2.1 pricing.event_price_config
-- Konfigurace dynamic pricing per event (per ticket_type)
-- ---------------------------------------------------------------------------

CREATE TABLE pricing.event_price_config (
    id                          UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Cross-schema reference (bez FK) — validace přes API
    ticket_type_id              UUID            NOT NULL UNIQUE,
    event_id                    UUID            NOT NULL,
    organizer_id                UUID            NOT NULL,

    -- Hlavní přepínač
    dynamic_pricing_enabled     BOOLEAN         NOT NULL DEFAULT FALSE,

    -- Guardrails (halíře)
    min_price_halire            INTEGER         NOT NULL CHECK (min_price_halire >= 0),
    max_price_halire            INTEGER         NOT NULL CHECK (max_price_halire > 0),
    CONSTRAINT chk_price_range CHECK (max_price_halire >= min_price_halire),

    -- Multiplikátory
    min_multiplier              NUMERIC(4, 2)   NOT NULL DEFAULT 1.00
        CHECK (min_multiplier > 0 AND min_multiplier <= 1.0),
    max_multiplier              NUMERIC(4, 2)   NOT NULL DEFAULT 1.50
        CHECK (max_multiplier >= 1.0),
    CONSTRAINT chk_multiplier_range CHECK (max_multiplier >= min_multiplier),

    -- Guardrail: max změna za jeden update cyklus (%)
    max_change_per_cycle_pct    SMALLINT        NOT NULL DEFAULT 20
        CHECK (max_change_per_cycle_pct BETWEEN 0 AND 50),

    -- Frekvence aktualizace (minuty)
    update_interval_minutes     SMALLINT        NOT NULL DEFAULT 5
        CHECK (update_interval_minutes BETWEEN 1 AND 60),

    -- Emergency mode threshold: při >= X% prodanosti zkrátit interval na 1 min
    emergency_threshold_pct     SMALLINT        NOT NULL DEFAULT 80
        CHECK (emergency_threshold_pct BETWEEN 50 AND 99),

    -- Feature váhy (musí se sečíst na přibližně 1.0, validace v aplikaci)
    weight_velocity             NUMERIC(4, 2)   NOT NULL DEFAULT 0.35,
    weight_capacity             NUMERIC(4, 2)   NOT NULL DEFAULT 0.30,
    weight_time_pressure        NUMERIC(4, 2)   NOT NULL DEFAULT 0.20,
    weight_historical           NUMERIC(4, 2)   NOT NULL DEFAULT 0.10,
    weight_external             NUMERIC(4, 2)   NOT NULL DEFAULT 0.05,

    -- Velocity okno (minuty) — jak daleko do minulosti sledujeme
    velocity_window_minutes     SMALLINT        NOT NULL DEFAULT 60
        CHECK (velocity_window_minutes BETWEEN 5 AND 1440),

    -- Externe faktory (optional JSON: {holiday: 0.15, competitor: -0.10, weather: 0.0})
    external_factors            JSONB           NOT NULL DEFAULT '{}',

    -- A/B experiment ID (null = žádný aktivní experiment)
    active_experiment_id        UUID,

    -- Metadata
    created_at                  TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE pricing.event_price_config IS
    'Konfigurace dynamic pricing per ticket type. Jeden řádek = jeden ticket type. Promotér nastavuje guardrails a váhy.';
COMMENT ON COLUMN pricing.event_price_config.min_multiplier IS
    'Minimální multiplikátor ceny (typicky 1.0 — cena neklesá pod fázovou cenu).';
COMMENT ON COLUMN pricing.event_price_config.max_multiplier IS
    'Maximální multiplikátor ceny (typicky 1.5 = max 50% zdražení nad fázovou cenu).';
COMMENT ON COLUMN pricing.event_price_config.max_change_per_cycle_pct IS
    'Guardrail: maximální povolená změna ceny za jeden update cyklus v procentech. Default 20%.';
COMMENT ON COLUMN pricing.event_price_config.external_factors IS
    'JSONB s externími faktory: {holiday_bonus: 0.15, competitor_penalty: -0.10}. Promotér vyplní ručně.';

CREATE INDEX idx_pricing_config_event_id
    ON pricing.event_price_config (event_id);

CREATE INDEX idx_pricing_config_organizer_id
    ON pricing.event_price_config (organizer_id);

CREATE TRIGGER trg_pricing_config_updated_at
    BEFORE UPDATE ON pricing.event_price_config
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2.2 pricing.demand_signals
-- Time-series snapshoty demand metrik — zdroj pro feature výpočet
-- ---------------------------------------------------------------------------

CREATE TABLE pricing.demand_signals (
    id                  BIGSERIAL       PRIMARY KEY,
    ticket_type_id      UUID            NOT NULL,
    event_id            UUID            NOT NULL,

    -- Snapshot dat v čase záznamu
    cumulative_sold     INTEGER         NOT NULL CHECK (cumulative_sold >= 0),
    remaining_qty       INTEGER         NOT NULL CHECK (remaining_qty >= 0),
    total_qty           INTEGER         NOT NULL CHECK (total_qty > 0),
    sold_pct            NUMERIC(5, 4)   NOT NULL
        GENERATED ALWAYS AS (cumulative_sold::NUMERIC / NULLIF(total_qty, 0)) STORED,

    -- Velocity: prodeje za posledních N minut (pre-computed při insertu)
    sales_last_5m       INTEGER         NOT NULL DEFAULT 0,
    sales_last_30m      INTEGER         NOT NULL DEFAULT 0,
    sales_last_60m      INTEGER         NOT NULL DEFAULT 0,

    -- Aktuální cena v době záznamu (halíře)
    current_price_halire INTEGER        NOT NULL CHECK (current_price_halire >= 0),
    current_phase       TEXT            NOT NULL,

    -- Demand score a multiplikátor (vypočítané při záznamu — pro analytics)
    demand_score        NUMERIC(5, 4),
    price_multiplier    NUMERIC(4, 2),

    recorded_at         TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE pricing.demand_signals IS
    'Time-series snímky demand metrik per ticket type. Záznamy každých 5 minut (dle update_interval_minutes). Slouží jako zdroj pro feature výpočet a ML trénink.';
COMMENT ON COLUMN pricing.demand_signals.sold_pct IS
    'Generovaný sloupec: cumulative_sold / total_qty. Nikdy NULL pokud total_qty > 0.';
COMMENT ON COLUMN pricing.demand_signals.sales_last_5m IS
    'Počet prodaných vstupenek za posledních 5 minut — pre-computed velocity feature.';

-- Primární dotaz: nejnovější signály pro konkrétní ticket type
CREATE INDEX idx_pricing_signals_ticket_type_time
    ON pricing.demand_signals (ticket_type_id, recorded_at DESC);

-- Pro ML trénink: dotaz přes event_id + časové okno
CREATE INDEX idx_pricing_signals_event_time
    ON pricing.demand_signals (event_id, recorded_at DESC);

-- Retention: staré záznamy (> 90 dní po eventu) lze archivovat/mazat
CREATE INDEX idx_pricing_signals_recorded_at
    ON pricing.demand_signals (recorded_at DESC);

-- ---------------------------------------------------------------------------
-- 2.3 pricing.price_points
-- Auditní log každé cenové změny — immutable append-only
-- ---------------------------------------------------------------------------

CREATE TABLE pricing.price_points (
    id                      BIGSERIAL       PRIMARY KEY,
    ticket_type_id          UUID            NOT NULL,
    event_id                UUID            NOT NULL,

    -- Cenová změna
    price_from_halire       INTEGER         NOT NULL CHECK (price_from_halire >= 0),
    price_to_halire         INTEGER         NOT NULL CHECK (price_to_halire >= 0),
    phase_price_halire      INTEGER         NOT NULL, -- fázová cena (před dynamic multiplikátorem)
    price_multiplier        NUMERIC(4, 2)   NOT NULL,
    demand_score            NUMERIC(5, 4)   NOT NULL,

    -- Proč se cena změnila (machine-readable)
    trigger_type            TEXT            NOT NULL
        CHECK (trigger_type IN (
            'dynamic_update',   -- pravidelný update z dynamic pricing enginu
            'phase_transition', -- přechod fáze (early_bird → regular atd.)
            'manual_override',  -- manuální zásah promotéra
            'experiment_assign',-- A/B test přiřazení
            'guardrail_clamp',  -- cena byla ořezána guardrailem
            'kill_switch'       -- dynamic pricing byl vypnut
        )),

    -- Feature hodnoty v době změny (pro explainability a ML)
    feature_snapshot        JSONB           NOT NULL DEFAULT '{}',
    -- Příklad: {"velocity_score": 0.72, "capacity_score": 0.45,
    --           "time_pressure_score": 0.30, "historical_score": 0.55,
    --           "external_score": 0.05, "velocity_window_minutes": 60,
    --           "sales_last_60m": 23, "remaining_qty": 87}

    -- Experiment kontext (null = bez experimentu)
    experiment_id           UUID,
    experiment_variant      TEXT            CHECK (experiment_variant IN ('control', 'treatment_a', 'treatment_b')),

    -- Kdo spustil (system job nebo user ID pro manuální override)
    triggered_by_user_id    UUID,

    created_at              TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE pricing.price_points IS
    'Immutable auditní log každé cenové změny. Nikdy se neupravuje, pouze přidávají řádky. Slouží pro analytics, explainability a ML trénink.';
COMMENT ON COLUMN pricing.price_points.feature_snapshot IS
    'JSONB snapshot všech feature hodnot v době cenové změny. Klíčový pro ML trénink a explainability.';
COMMENT ON COLUMN pricing.price_points.trigger_type IS
    'Typ triggeru: dynamic_update = pravidelný job, guardrail_clamp = cena byla ořezána limitem.';

CREATE INDEX idx_pricing_points_ticket_type_time
    ON pricing.price_points (ticket_type_id, created_at DESC);

CREATE INDEX idx_pricing_points_event_time
    ON pricing.price_points (event_id, created_at DESC);

CREATE INDEX idx_pricing_points_experiment
    ON pricing.price_points (experiment_id)
    WHERE experiment_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2.4 pricing.price_experiments
-- A/B testy cenových strategií
-- ---------------------------------------------------------------------------

CREATE TABLE pricing.price_experiments (
    id                      UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_type_id          UUID            NOT NULL,
    event_id                UUID            NOT NULL,
    organizer_id            UUID            NOT NULL,

    name                    TEXT            NOT NULL,
    description             TEXT,

    status                  TEXT            NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'running', 'paused', 'completed', 'aborted')),

    -- Varianta control: konfigurace dynamic pricing (nebo static = vypnuté dynamic)
    control_config          JSONB           NOT NULL DEFAULT '{}',
    -- Varianta treatment_a: jiné váhy nebo multiplikátory
    treatment_a_config      JSONB           NOT NULL DEFAULT '{}',
    -- Volitelná druhá treatment varianta
    treatment_b_config      JSONB,

    -- Traffic split (musí se sečíst na 100)
    control_pct             SMALLINT        NOT NULL DEFAULT 50
        CHECK (control_pct BETWEEN 0 AND 100),
    treatment_a_pct         SMALLINT        NOT NULL DEFAULT 50
        CHECK (treatment_a_pct BETWEEN 0 AND 100),
    treatment_b_pct         SMALLINT        NOT NULL DEFAULT 0
        CHECK (treatment_b_pct BETWEEN 0 AND 100),
    CONSTRAINT chk_experiment_split
        CHECK (control_pct + treatment_a_pct + treatment_b_pct = 100),

    -- Metriky — vyplní se po ukončení experimentu
    winner_variant          TEXT            CHECK (winner_variant IN ('control', 'treatment_a', 'treatment_b')),
    result_summary          JSONB,
    -- Příklad: {"control_revenue_per_seat": 45000, "treatment_a_revenue_per_seat": 48200,
    --           "control_sellthrough": 0.73, "treatment_a_sellthrough": 0.71,
    --           "p_value": 0.032, "confidence_pct": 95}

    started_at              TIMESTAMPTZ,
    ended_at                TIMESTAMPTZ,
    created_at              TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE pricing.price_experiments IS
    'A/B testy cenových strategií per ticket type. Bucket assignment přes session_id hash — ne user_id (GDPR, fairness).';
COMMENT ON COLUMN pricing.price_experiments.control_config IS
    'JSONB konfigurace kontrolní skupiny. Může být prázdné {} = použij výchozí event_price_config.';
COMMENT ON COLUMN pricing.price_experiments.result_summary IS
    'Shrnutí výsledků po ukončení: revenue per seat, sell-through rate, p-value, confidence.';

CREATE INDEX idx_pricing_experiments_ticket_type
    ON pricing.price_experiments (ticket_type_id);

CREATE INDEX idx_pricing_experiments_status
    ON pricing.price_experiments (status)
    WHERE status = 'running';

CREATE TRIGGER trg_pricing_experiments_updated_at
    BEFORE UPDATE ON pricing.price_experiments
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
```

### 2.2 Agregace historických dat pro ML trénink

Dotaz pro přípravu training datasetu (spouštěn batch jobem, výstup do S3/local model registry):

```sql
-- Feature matrix pro ML trénink
-- Jeden řádek = jedna cenová změna + výsledek (konverze) v následující hodině
WITH price_changes AS (
    SELECT
        pp.id,
        pp.ticket_type_id,
        pp.event_id,
        pp.price_to_halire,
        pp.price_from_halire,
        pp.price_multiplier,
        pp.demand_score,
        pp.feature_snapshot,
        pp.created_at,
        -- Label: počet prodaných vstupenek v hodině po cenové změně
        COALESCE(
            (SELECT ds2.cumulative_sold - ds1.cumulative_sold
             FROM pricing.demand_signals ds1
             JOIN pricing.demand_signals ds2 ON ds2.ticket_type_id = pp.ticket_type_id
             WHERE ds1.ticket_type_id = pp.ticket_type_id
               AND ds1.recorded_at >= pp.created_at
               AND ds2.recorded_at >= pp.created_at + INTERVAL '60 minutes'
             ORDER BY ds1.recorded_at ASC, ds2.recorded_at ASC
             LIMIT 1),
            0
        ) AS sales_after_1h
    FROM pricing.price_points pp
    WHERE pp.trigger_type = 'dynamic_update'
      AND pp.created_at < NOW() - INTERVAL '1 hour'
)
SELECT
    pc.*,
    -- Price delta % (feature pro model)
    ROUND(
        (pc.price_to_halire - pc.price_from_halire)::NUMERIC
        / NULLIF(pc.price_from_halire, 0) * 100,
        2
    ) AS price_change_pct,
    -- Label: konverze (1 = alespoň jeden prodej v hodině po změně)
    CASE WHEN pc.sales_after_1h > 0 THEN 1 ELSE 0 END AS converted
FROM price_changes pc;
```

### 2.3 Feature Store v Redis — klíčová schémata

```
# Aktuální demand features (TTL: 5 minut)
pricing:features:{ticketTypeId}
→ JSON: { velocity_score, capacity_score, time_pressure_score,
          historical_score, external_score, demand_score,
          sales_last_5m, sales_last_30m, sales_last_60m,
          remaining_qty, sold_pct, computed_at }

# Výsledný multiplikátor (TTL: update_interval_minutes)
pricing:multiplier:{ticketTypeId}
→ JSON: { multiplier, final_price_halire, guardrail_applied, computed_at }

# A/B experiment bucket pro session (TTL: 24 hodiny)
pricing:experiment:{experimentId}:session:{sessionHash}
→ STRING: "control" | "treatment_a" | "treatment_b"

# Historical benchmark (TTL: 1 hodina — méně volatilní)
pricing:benchmark:{eventId}:similar_sellthrough
→ JSON: { median_sellthrough, sample_size, computed_at }
```

---

## 3. Integrace s existujícím pricing-engine

### 3.1 Rozšíření PricingService — zero breaking change

Klíčový princip: `DynamicPricingEngine` je **dekorátor** nad existujícím `PricingService`. Volá původní `getCurrentPrice()` a pak aplikuje dynamic multiplier.

```typescript
// src/services/dynamic-pricing.service.ts

export interface DynamicPricingDbAdapter {
  getEventPriceConfig(ticketTypeId: string): Promise<EventPriceConfig | null>;
  getDemandSignals(ticketTypeId: string, windowMinutes: number): Promise<DemandSignal[]>;
  getHistoricalBenchmark(eventId: string): Promise<HistoricalBenchmark | null>;
  insertDemandSignal(signal: Omit<DemandSignal, 'id'>): Promise<void>;
  insertPricePoint(point: Omit<PricePoint, 'id'>): Promise<void>;
  getActiveSimilarEvents(eventId: string): Promise<SimilarEventSummary[]>;
}

export class DynamicPricingService {
  constructor(
    private readonly pricingService: PricingService,   // existující service
    private readonly db: DynamicPricingDbAdapter,
    private readonly cache: CacheAdapter,              // stejný adapter
    private readonly eventBus: EventBusAdapter,        // stejný adapter
  ) {}

  async getCurrentDynamicPrice(
    ticketTypeId: string,
    sessionId?: string,                                // pro A/B experiment bucket
  ): Promise<DynamicPriceCalculation> {
    // 1. Načteme fázovou cenu z existujícího enginu (z Redis cache nebo DB)
    const phaseCalc = await this.pricingService.getCurrentPrice(ticketTypeId);

    // 2. Zkontrolujeme, zda je dynamic pricing zapnuté
    const config = await this.db.getEventPriceConfig(ticketTypeId);
    if (config === null || !config.dynamic_pricing_enabled) {
      // Fallback: vrátíme původní výpočet, rozšířený o dynamic pricing metadata
      return {
        ...phaseCalc,
        dynamicPricingEnabled: false,
        dynamicMultiplier: 1.0,
        demandScore: null,
        featureSnapshot: null,
        isDynamic: false,
      };
    }

    // 3. Zkusíme Redis cache pro multiplier
    const cachedMultiplier = await this.cache.get(`pricing:multiplier:${ticketTypeId}`);
    if (cachedMultiplier !== null) {
      const cached = JSON.parse(cachedMultiplier) as CachedMultiplier;
      const dynamicFinalPrice = cached.final_price_halire;
      return {
        ...phaseCalc,
        finalPrice: dynamicFinalPrice,  // override fázové finalPrice
        dynamicPricingEnabled: true,
        dynamicMultiplier: cached.multiplier,
        demandScore: cached.demand_score,
        featureSnapshot: null,          // neexposeovat zákazníkovi
        isDynamic: true,
        guardrailApplied: cached.guardrail_applied,
      };
    }

    // 4. Vypočítáme features a demand score
    const features = await this.computeFeatures(ticketTypeId, config, phaseCalc);
    const demandScore = this.computeDemandScore(features, config);
    const multiplier = this.computePriceMultiplier(demandScore, config);
    const dynamicFinalPrice = this.applyMultiplierToPrice(
      phaseCalc.phasePrice,
      multiplier,
      config,
      phaseCalc.finalPrice, // předchozí cena pro max_change guardrail
    );

    const guardrailApplied = dynamicFinalPrice !== Math.ceil(phaseCalc.phasePrice * multiplier / 1000) * 1000;

    // 5. Cache výsledek
    const ttlSeconds = config.update_interval_minutes * 60;
    await this.cache.set(
      `pricing:multiplier:${ticketTypeId}`,
      JSON.stringify({
        multiplier,
        final_price_halire: dynamicFinalPrice,
        demand_score: demandScore,
        guardrail_applied: guardrailApplied,
        computed_at: new Date().toISOString(),
      }),
      ttlSeconds,
    );

    return {
      ...phaseCalc,
      finalPrice: dynamicFinalPrice,
      dynamicPricingEnabled: true,
      dynamicMultiplier: multiplier,
      demandScore,
      featureSnapshot: features,
      isDynamic: true,
      guardrailApplied,
    };
  }

  // Spouštěno z DynamicPricingJob každých update_interval_minutes
  async runUpdateCycle(ticketTypeId: string): Promise<void> {
    // 1. Snapshot demand signals do DB
    // 2. Invalidovat Redis cache multiplikatoru
    // 3. Emit Kafka event: pricing.dynamic_price_updated
    // 4. Logovat do pricing.price_points
  }
}
```

### 3.2 Koexistence s fázovým zdražováním

```
Fázová cena (pricing_rules) → phasePrice
        ↓
Dynamic multiplier (demand_score × config) → dynamicMultiplier
        ↓
Guardrails (min/max/delta) → guardrailApplied
        ↓
finalPrice = round_up_10kc(phasePrice × dynamicMultiplier)
        ↓
[vždy]: min(max_price, max(min_price, finalPrice))
```

Dynamic pricing operuje **uvnitř** fázové ceny:
- Fáze určuje `phasePrice` (Early Bird = nízká, Door = vysoká)
- Dynamic engine aplikuje multiplikátor `[min_multiplier, max_multiplier]` na `phasePrice`
- Fázový přechod (Early Bird → Regular) zvýší `phasePrice`, dynamic engine pak pracuje od nové základny

### 3.3 API kontrakt — nový endpoint

```
GET /api/events/{eventId}/ticket-types/{ticketTypeId}/price
```

Tento endpoint **již existuje** v `pricing-engine/src/app/api/.../price/route.ts`. Stačí ho rozšířit o response fields:

```typescript
// Rozšířená response (backward compatible — přidáváme pole, neměníme stávající)
interface DynamicPriceResponse extends PriceCalculation {
  serverTime: number;

  // Nová pole pro dynamic pricing
  isDynamic: boolean;
  dynamicPricingEnabled: boolean;
  dynamicMultiplier: number;             // pro pořadatelský dashboard
  demandScore: number | null;            // pro pořadatelský dashboard
  guardrailApplied: boolean;             // transparency: guardrail zasáhl

  // UX transparency fields
  priceIsChanging: boolean;              // true = dynamic pricing aktivní
  priceLastUpdatedAt: string;            // ISO timestamp poslední aktualizace ceny
  nextUpdateAt: string | null;           // ISO timestamp příštího plánovaného update
}
```

### 3.4 Frontend real-time komunikace

Strategie: **polling + SSE pro high-demand eventy**

| Scénář | Řešení | Zdůvodnění |
|---|---|---|
| Normální prodej | Polling každých 30s (existující v `PriceDisplay.tsx`) | Jednoduché, robustní, funguje za CDN |
| High-demand event (`sold_pct > 0.7`) | SSE endpoint `/api/events/{eventId}/price-stream` | Real-time bez WebSocket overhead |
| Fázový přechod | Kafka → webhook → SSE push | Okamžitá notifikace i při poll intervalu |

SSE endpoint (nový):

```typescript
// GET /api/events/{eventId}/price-stream
// Posílá SSE eventy při cenové změně (Kafka konsument → Redis pub/sub → SSE)

export async function GET(request: NextRequest, { params }: RouteContext) {
  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();

      // Subscribe na Redis pub/sub kanál
      const channel = `pricing:updates:${params.eventId}`;
      redisSubscriber.subscribe(channel, (message) => {
        controller.enqueue(encoder.encode(`data: ${message}\n\n`));
      });

      // Heartbeat každých 25s (proxy timeout)
      const heartbeat = setInterval(() => {
        controller.enqueue(encoder.encode(': heartbeat\n\n'));
      }, 25_000);

      request.signal.addEventListener('abort', () => {
        clearInterval(heartbeat);
        redisSubscriber.unsubscribe(channel);
      });
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
```

`PriceDisplay.tsx` rozšíříme: při `isDynamic: true` nahradíme polling SSE připojením.

---

## 4. A/B testování cenových strategií

### 4.1 Bucket assignment bez price discrimination

**Problém:** Pokud by různí uživatelé za stejný ticket viděli různé ceny ve stejný okamžik, mohlo by to být vnímáno jako price discrimination.

**Řešení: Session-based bucketing + transparentní komunikace**

```typescript
function assignExperimentVariant(
  experimentId: string,
  sessionId: string,  // anonymní session token, ne user_id
  controlPct: number,
  treatmentAPct: number,
): 'control' | 'treatment_a' | 'treatment_b' {
  // Deterministický hash: stejná session vždy dostane stejnou variantu
  const hash = crypto
    .createHash('sha256')
    .update(`${experimentId}:${sessionId}`)
    .digest('hex');

  // Vezme první 4 bajty jako uint32, normalizuje na 0–100
  const bucket = (parseInt(hash.slice(0, 8), 16) % 100) + 1;

  if (bucket <= controlPct) return 'control';
  if (bucket <= controlPct + treatmentAPct) return 'treatment_a';
  return 'treatment_b';
}
```

Proč session, ne user:
- GDPR: nevyžaduje linking na identitu
- Fairness: při novém session dostane zákazník aktuální cenu (ne historicky zamknutou)
- Nelogin uživatelé jsou zahrnuti stejně

Důležité: **Cena se nemění zákazníkovi v průběhu jedné session.** Bucket je zamknut na 24 hodin (Redis TTL). Pokud zákazník zavře browser a vrátí se, dostane nový bucket — akceptovatelné.

### 4.2 Metriky experimentu

```sql
-- Query pro výsledky experimentu
SELECT
    pp.experiment_variant,
    COUNT(DISTINCT pp.ticket_type_id)               AS ticket_types,
    -- Revenue per seat (hlavní metrika)
    AVG(pp.price_to_halire)                         AS avg_price_halire,
    SUM(pp.price_to_halire)                         AS total_revenue_halire,
    -- Sell-through rate proxy (% prodanosti v době cenové změny)
    AVG((pp.feature_snapshot->>'sold_pct')::NUMERIC) AS avg_sellthrough,
    -- Velocity (rychlost prodeje)
    AVG((pp.feature_snapshot->>'sales_last_60m')::INTEGER) AS avg_velocity_60m,
    COUNT(*)                                        AS price_updates
FROM pricing.price_points pp
WHERE pp.experiment_id = $1
  AND pp.trigger_type = 'dynamic_update'
GROUP BY pp.experiment_variant
ORDER BY pp.experiment_variant;
```

Rozhodnutí o vítězi: **bayesovský přístup** (jednodušší než frequentistický pro malé vzorky CZ/SK trhu):

```
P(treatment_a > control) = Beta posterior comparison
Threshold pro zastavení: P(winner) > 0.95 NEBO experiment trval > 14 dní
```

### 4.3 Ukončení experimentu

1. Status experimentu → `completed`, winner_variant vyplněn
2. `active_experiment_id` v `event_price_config` nastaven na `NULL`
3. Konfigurace vítězné varianty zkopírována do `event_price_config`
4. Všechny session buckety zneplatněny (Redis DEL pattern `pricing:experiment:{id}:*`)
5. Kafka event: `pricing.experiment_completed`

---

## 5. Fairness, etika a regulatorní pohled

### 5.1 Price discrimination — co je a co není problém

**Zakázáno (a technicky zabráněno):**
- Různá cena pro různé demografické skupiny (věk, pohlaví, národnost)
- Různá cena pro různé registrované uživatele ve stejný okamžik za stejné místo

**Povoleno (a naše implementace):**
- Různá cena v různých časech (temporal pricing) — zcela standardní
- Různá cena v různých fázích prodeje — platforma to dělá od začátku
- A/B experiment: různá cena pro různé sessions (anonymní, bez demographického cílení)

Technická ochrana: `assignExperimentVariant()` přijímá pouze `sessionId` — nikdy `userId`, `age`, `gender`, `country`. Toto je vynuceno typovým systémem (DbAdapter neposkytuje demografické atributy cenové funkci).

### 5.2 Price anchoring — UX bez klamání

Zobrazovat "původní cena" smíme pouze pokud:
- Zákazník **skutečně mohl koupit za tu cenu** (Early Bird existoval a byl veřejně prodáván)
- Přeškrtnutá cena je max. posledních 30 dní (Spotřebitelské právo EU — Omnibus směrnice 2019/2161)

```typescript
// Komponenta PriceDisplay.tsx — rozšíření
interface DynamicPriceDisplayProps {
  showAnchorPrice: boolean;       // zobrazit "bylo X Kč"?
  anchorPrice?: number;           // musí být reálná historická cena z price_points
  anchorPriceDate?: Date;         // datum, kdy tato cena platila
  isDynamic: boolean;             // zobrazit "cena se mění" badge
}
```

UX komunikace dinamické ceny (konkrétní texty):
- Badge: `Dynamická cena` nebo `Cena roste s poptávkou`
- Tooltip: `Cena se automaticky přizpůsobuje poptávce. Čím více lístků se prodá, tím vyšší cena.`
- Alert při zvýšení ceny: `Cena vzrostla. Nakupte nyní.` (pouze pokud SSE zachytí změnu)
- V košíku: cena zamknuta na 15 minut (stávající košíkový timeout) — zákazník není překvapen při platbě

### 5.3 Regulatorní analýza (CZ/EU)

**Závěr: Dynamic pricing pro ticketing je v CZ/EU legální s podmínkami:**

| Aspekt | Povinnost | Naše implementace |
|---|---|---|
| Informace o dynamické ceně | ANO — UCPD (nekalé obchodní praktiky), zákon č. 634/1992 Sb. | `isDynamic: true` badge zobrazujeme zákazníkovi |
| Cena musí být jasně sdělena před nákupem | ANO | Cena locked v košíku, zobrazena před platbou |
| Zákaz price discrimination dle národnosti | ANO (TFEU čl. 18) | Bucketing na session, ne geografii |
| Omnibus směrnice — referenční cena | ANO — "nejnižší cena za posledních 30 dní" pokud zobrazujeme přeškrtnutou cenu | `anchorPriceDate` kontrola v komponentě |
| GDPR | ANO — neprovádíme profilování na základě chráněných atributů | Session-based, ne user-based experiment |
| Ticketing Regulation EU 2023 (v přípravě) | POZOR: navrhuje cap na resale, ne na primary | Naše primary pricing není regulována (únor 2026) |

---

## 6. Cold start problem

### 6.1 Nový event bez historických dat

**Strategie 3 vrstev:**

**Vrstva 1 — Konzervativní default konfigurace:**

```typescript
const DEFAULT_COLD_START_CONFIG: Partial<EventPriceConfig> = {
  dynamic_pricing_enabled: true,
  min_multiplier: 1.00,         // cena neklesá
  max_multiplier: 1.20,         // max 20% zdražení (konzervativní pro cold start)
  max_change_per_cycle_pct: 10, // jen 10% per cyklus
  weight_velocity: 0.50,        // velocity dostane vyšší váhu (nejrychlejší feedback)
  weight_capacity: 0.30,
  weight_time_pressure: 0.15,
  weight_historical: 0.05,      // minimal dokud nemáme data
  weight_external: 0.00,
};
```

**Vrstva 2 — Borrowing from podobných eventů:**

Využíváme existující `ai.event_features` tabulku (z AI personalizačního modulu):

```sql
-- Nalezení podobných eventů pro cold start benchmark
SELECT
    ef.event_id,
    ef.sell_through_rate,
    ef.sales_velocity_24h,
    ef.total_sold,
    -- Skóre podobnosti (vyšší = podobnější)
    (
        CASE WHEN ef.category = $target_category THEN 0.4 ELSE 0 END +
        CASE WHEN ef.venue_city = $target_city THEN 0.2 ELSE 0 END +
        CASE WHEN ABS(ef.base_price_min_czk - $target_price) / NULLIF($target_price, 0) < 0.3 THEN 0.2 ELSE 0 END +
        CASE WHEN ABS(ef.venue_capacity - $target_capacity) / NULLIF($target_capacity, 0) < 0.3 THEN 0.1 ELSE 0 END +
        CASE WHEN ef.is_weekend = $target_is_weekend THEN 0.1 ELSE 0 END
    ) AS similarity_score
FROM ai.event_features ef
WHERE ef.event_id != $target_event_id
  AND ef.sell_through_rate IS NOT NULL
  AND ef.total_sold > 10   -- minimální vzorek
ORDER BY similarity_score DESC, ef.computed_at DESC
LIMIT 10;
```

Mediánový `sell_through_rate` z top-10 podobných eventů se použije jako `historical_score` baseline.

**Vrstva 3 — Rychlé učení po prvních prodejích:**

- Při 0 prodejích: `demand_score = 0.3` (konzervativní neutrální hodnota)
- Při 1–10 prodejích: velocity score počítáme s vysokou váhou, ale damped (Bayesian smoothing)
- Při >10 prodejích: přecházíme na plný výpočet

```typescript
function computeVelocityScoreWithColdStart(
  salesLast60m: number,
  totalSold: number,
  config: EventPriceConfig,
): number {
  // Prior: průměr z podobných eventů (0.5 = neutrální)
  const COLD_START_PRIOR = 0.5;
  const COLD_START_WEIGHT = Math.max(0, 1 - totalSold / 20); // klesá s každým prodejem

  const rawScore = computeVelocityScore(/* ... */);
  return COLD_START_WEIGHT * COLD_START_PRIOR + (1 - COLD_START_WEIGHT) * rawScore;
}
```

Po prvním prodeji (Kafka event `OrderCompleted`): okamžitě aktualizovat demand signals, nemusíme čekat na pravidelný cyklus.

---

## 7. Implementační plán pro task #73

### 7.1 Pořadí souborů k vytvoření

**Sprint 1 — Datová vrstva (DB + typy)**

```
1. pricing-engine/src/types/dynamic-pricing.ts
   — Nové TypeScript interfaces: EventPriceConfig, DemandSignal, PricePoint,
     PriceExperiment, DynamicPriceCalculation, FeatureSnapshot

2. pricing-engine/migrations/001_create_pricing_schema.sql
   — SQL z tohoto dokumentu (pricing.event_price_config,
     pricing.demand_signals, pricing.price_points, pricing.price_experiments)

3. pricing-engine/src/lib/feature-calculator.ts
   — Pure funkce: computeVelocityScore, computeCapacityScore,
     computeTimePressureScore, computeHistoricalScore, computeDemandScore
   — Unit-testovatelné bez DB/Redis závislosti
```

**Sprint 2 — Service vrstva**

```
4. pricing-engine/src/services/dynamic-pricing.service.ts
   — DynamicPricingService class
   — DynamicPricingDbAdapter interface
   — getCurrentDynamicPrice(), computeFeatures(), applyMultiplierToPrice()
   — Cold start logic s Bayesian smoothing

5. pricing-engine/src/lib/dynamic-pricing-calculator.ts
   — computePriceMultiplier(), applyGuardrails()
   — Všechny guardrail checks (min/max price, max change per cycle)

6. pricing-engine/src/services/experiment.service.ts
   — assignExperimentVariant() — deterministický session hash
   — getActiveExperiment(), recordExperimentAssignment()
```

**Sprint 3 — Job vrstva**

```
7. pricing-engine/src/jobs/dynamic-pricing.job.ts
   — DynamicPricingJob: interval job (jako existující PhaseCheckerJob)
   — runBatch(): iteruje přes eventy s dynamic_pricing_enabled=true
   — Volá runUpdateCycle() pro každý ticket type
   — Zapisuje demand snapshots do pricing.demand_signals
   — Invaliduje Redis cache
   — Emituje Kafka event: pricing.dynamic_price_updated

8. pricing-engine/src/jobs/cold-start-benchmarks.job.ts
   — ColdStartBenchmarksJob: 1×/hodinu
   — Počítá historical benchmarks z ai.event_features
   — Cachuje do Redis pricing:benchmark:{eventId}:similar_sellthrough
```

**Sprint 4 — API vrstva**

```
9. pricing-engine/src/app/api/events/[eventId]/ticket-types/[ticketTypeId]/price/route.ts
   — UPRAVIT (ne vytvořit) — rozšířit response o DynamicPriceCalculation fields
   — Backward compatible — stávající pole zůstávají beze změny

10. pricing-engine/src/app/api/events/[eventId]/price-stream/route.ts
    — Nový SSE endpoint pro real-time cenové updaty
    — Redis pub/sub subscriber

11. pricing-engine/src/app/api/events/[eventId]/ticket-types/[ticketTypeId]/pricing-config/route.ts
    — GET/PUT pro promotéra: nastavení guardrails, vah, enable/disable

12. pricing-engine/src/app/api/events/[eventId]/pricing-experiments/route.ts
    — CRUD pro A/B experimenty
```

**Sprint 5 — Frontend**

```
13. pricing-engine/src/components/PriceDisplay.tsx
    — UPRAVIT — přidat isDynamic badge, SSE subscriber, price anchor

14. pricing-engine/src/components/DynamicPricingBadge.tsx
    — Nová komponenta: "Cena roste s poptávkou" badge s tooltip

15. pricing-engine/src/components/PricingConfigPanel.tsx
    — Pořadatelský panel: nastavení dynamic pricing per event
```

**Sprint 6 — Testy**

```
16. pricing-engine/src/lib/feature-calculator.test.ts
    — Unit testy pro všechny score funkce: edge cases, boundary values

17. pricing-engine/src/services/dynamic-pricing.service.test.ts
    — Integration testy s mock DB a Redis

18. pricing-engine/src/lib/guardrails.test.ts
    — Testy guardrailů: min price, max price, max change per cycle
```

### 7.2 Závislosti (npm packages)

```json
{
  "dependencies": {
    "ioredis": "^5.3.2",       // Redis client (SSE pub/sub, cache)
    "kafkajs": "^2.2.4",       // Kafka producer/consumer
    "pg": "^8.11.0",           // PostgreSQL client
    "zod": "^3.22.0"           // Runtime validace API vstupů (již používáno v recommendation-engine)
  },
  "devDependencies": {
    "@types/pg": "^8.11.0",
    "vitest": "^1.6.0"         // již existuje
  }
}
```

Žádné ML runtime závislosti (Python, TensorFlow) v první iteraci — plný TypeScript rule-based engine. ML trénink (XGBoost pro task #74–#76) poběží jako separátní Python microservice nebo Jupyter notebook mimo Next.js.

### 7.3 Klíčové dependencies mezi soubory

```
types/dynamic-pricing.ts
    ↓
lib/feature-calculator.ts (pure funkce, bez imports)
    ↓
lib/dynamic-pricing-calculator.ts (guardrails)
    ↓
services/dynamic-pricing.service.ts (orchestrace, cache, DB)
    ↓
jobs/dynamic-pricing.job.ts (scheduling)
    ↓
app/api/.../price/route.ts (HTTP layer)
    ↓
components/PriceDisplay.tsx (React)
```

### 7.4 Integrace s existujícím PhaseCheckerJob

`DynamicPricingJob` a `PhaseCheckerJob` jsou **oddělené joby**:
- `PhaseCheckerJob`: interval 1 minuta, mění fázi (early_bird → regular)
- `DynamicPricingJob`: interval 5 minut (konfigurovatelný), aktualizuje dynamic multiplier

Při fázovém přechodu `PhaseCheckerJob` emituje `pricing.phase_changed` Kafka event — `DynamicPricingJob` naslouchá a okamžitě spouští update cyklus mimo pravidelný interval (forced refresh).

---

## 8. Architektura — přehledový diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                   AI Dynamic Pricing Engine                              │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │  DynamicPricingJob (každých N minut per ticket type)             │   │
│  │                                                                  │   │
│  │  1. Snapshot → pricing.demand_signals (DB)                       │   │
│  │  2. Compute features → Redis pricing:features:{ttId}             │   │
│  │  3. Compute demand_score + multiplier                            │   │
│  │  4. Apply guardrails                                             │   │
│  │  5. Append → pricing.price_points (DB, immutable)               │   │
│  │  6. Set → Redis pricing:multiplier:{ttId} (TTL: N min)          │   │
│  │  7. Publish → Redis channel pricing:updates:{eventId}           │   │
│  │  8. Emit Kafka → pricing.dynamic_price_updated                  │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                          │
│  ┌─────────────────────┐    ┌─────────────────────────────────────┐    │
│  │  PhaseCheckerJob    │    │  ColdStartBenchmarksJob (1×/hodinu) │    │
│  │  (existující)       │    │  ai.event_features → Redis benchmark│    │
│  │  → phase_changed    │    └─────────────────────────────────────┘    │
│  │  → force refresh    │                                                │
│  └─────────────────────┘                                                │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │  DynamicPricingService.getCurrentDynamicPrice(ticketTypeId)      │   │
│  │                                                                  │   │
│  │  PricingService.getCurrentPrice()   ← existující (neměníme)     │   │
│  │       ↓ phasePrice                                               │   │
│  │  Redis pricing:multiplier:{ttId}    ← hot cache (TTL N min)     │   │
│  │       ↓ multiplier × phasePrice                                  │   │
│  │  Guardrails (min/max/delta)                                      │   │
│  │       ↓ finalDynamicPrice                                        │   │
│  │  DynamicPriceCalculation (response)                             │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                          │
│  ┌────────────────────────┐  ┌──────────────────────────────────────┐  │
│  │  GET .../price         │  │  GET .../price-stream (SSE)          │  │
│  │  ← DynamicPriceCalc    │  │  ← Redis pub/sub                     │  │
│  │  polling 30s           │  │  push on price change                │  │
│  └────────────────────────┘  └──────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘

Datové toky:
  Kafka OrderCompleted → DemandSignal update (okamžitě)
  PhaseCheckerJob → pricing.phase_changed → DynamicPricingJob force refresh
  DynamicPricingJob → pricing.demand_signals + pricing.price_points (append)
  DynamicPricingJob → Redis cache + Redis pub/sub
  SSE endpoint → Redis subscriber → EventSource (browser)
```

---

## 9. TypeScript interface definice — kompletní

```typescript
// src/types/dynamic-pricing.ts

import type { PriceCalculation, PricingPhase } from './pricing';

// ─── Konfigurace ───────────────────────────────────────────────────────────────

export interface EventPriceConfig {
  id: string;
  ticketTypeId: string;
  eventId: string;
  organizerId: string;

  dynamicPricingEnabled: boolean;

  // Guardrails (halíře)
  minPriceHalire: number;       // INTEGER halíře
  maxPriceHalire: number;       // INTEGER halíře

  // Multiplikátory
  minMultiplier: number;        // typicky 1.00
  maxMultiplier: number;        // typicky 1.50

  // Guardrail: max změna za cyklus (%)
  maxChangePerCyclePct: number; // 0–50

  // Frekvence
  updateIntervalMinutes: number; // 1–60
  emergencyThresholdPct: number; // 50–99

  // Feature váhy
  weightVelocity: number;
  weightCapacity: number;
  weightTimePressure: number;
  weightHistorical: number;
  weightExternal: number;

  velocityWindowMinutes: number;

  externalFactors: Record<string, number>;

  activeExperimentId: string | null;
}

// ─── Demand signals ────────────────────────────────────────────────────────────

export interface DemandSignal {
  id: bigint;
  ticketTypeId: string;
  eventId: string;

  cumulativeSold: number;
  remainingQty: number;
  totalQty: number;
  soldPct: number;            // computed: cumulativeSold / totalQty

  salesLast5m: number;
  salesLast30m: number;
  salesLast60m: number;

  currentPriceHalire: number;  // INTEGER halíře
  currentPhase: PricingPhase;

  demandScore: number | null;
  priceMultiplier: number | null;

  recordedAt: Date;
}

// ─── Feature snapshot ──────────────────────────────────────────────────────────

export interface FeatureSnapshot {
  velocityScore: number;
  capacityScore: number;
  timePressureScore: number;
  historicalScore: number;
  externalScore: number;

  // Raw data pro explainability
  salesLast60m: number;
  soldPct: number;
  remainingQty: number;
  hoursToEvent: number;
  velocityWindowMinutes: number;
  similarEventMedianSellthrough: number | null;
}

// ─── Price points (audit log) ─────────────────────────────────────────────────

export type PricePointTriggerType =
  | 'dynamic_update'
  | 'phase_transition'
  | 'manual_override'
  | 'experiment_assign'
  | 'guardrail_clamp'
  | 'kill_switch';

export interface PricePoint {
  id: bigint;
  ticketTypeId: string;
  eventId: string;

  priceFromHalire: number;    // INTEGER halíře
  priceToHalire: number;      // INTEGER halíře
  phasePriceHalire: number;   // INTEGER halíře
  priceMultiplier: number;
  demandScore: number;

  triggerType: PricePointTriggerType;
  featureSnapshot: FeatureSnapshot;

  experimentId: string | null;
  experimentVariant: 'control' | 'treatment_a' | 'treatment_b' | null;

  triggeredByUserId: string | null;
  createdAt: Date;
}

// ─── Experimenty ───────────────────────────────────────────────────────────────

export type ExperimentStatus = 'draft' | 'running' | 'paused' | 'completed' | 'aborted';
export type ExperimentVariant = 'control' | 'treatment_a' | 'treatment_b';

export interface PriceExperiment {
  id: string;
  ticketTypeId: string;
  eventId: string;
  organizerId: string;

  name: string;
  description: string | null;
  status: ExperimentStatus;

  controlConfig: Partial<EventPriceConfig>;
  treatmentAConfig: Partial<EventPriceConfig>;
  treatmentBConfig: Partial<EventPriceConfig> | null;

  controlPct: number;
  treatmentAPct: number;
  treatmentBPct: number;

  winnerVariant: ExperimentVariant | null;
  resultSummary: ExperimentResults | null;

  startedAt: Date | null;
  endedAt: Date | null;
}

export interface ExperimentResults {
  controlRevenuePerSeat: number;   // halíře
  treatmentARevenuePerSeat: number; // halíře
  treatmentBRevenuePerSeat?: number;
  controlSellthrough: number;
  treatmentASellthrough: number;
  pValue: number;
  confidencePct: number;
}

// ─── Dynamic price calculation (response) ─────────────────────────────────────

export interface DynamicPriceCalculation extends PriceCalculation {
  // Dynamic pricing metadata
  isDynamic: boolean;
  dynamicPricingEnabled: boolean;
  dynamicMultiplier: number;
  demandScore: number | null;
  guardrailApplied: boolean;

  // UX transparency
  priceIsChanging: boolean;
  priceLastUpdatedAt: Date;
  nextUpdateAt: Date | null;

  // Experiment kontext (null = žádný experiment)
  experimentVariant: ExperimentVariant | null;
}

// ─── Historical benchmark ──────────────────────────────────────────────────────

export interface HistoricalBenchmark {
  eventId: string;
  medianSellthrough: number;
  sampleSize: number;
  computedAt: Date;
}

export interface SimilarEventSummary {
  eventId: string;
  sellThroughRate: number;
  salesVelocity24h: number;
  similarityScore: number;
}
```

---

## 10. Potenciální rizika a mitigace

| Riziko | Pravděpodobnost | Dopad | Mitigace |
|---|---|---|---|
| Cena se mění příliš rychle → zákazník ztratí důvěru | Střední | Vysoký | `max_change_per_cycle_pct` guardrail, výchozí 20% |
| Bot farming: umělé falešné objednávky zvyšují demand score | Střední | Střední | Velocity score počítáme z **completed** objednávek (orders.status = 'paid'), ne cart starts |
| Race condition: dva joby modifikují cenu současně | Nízká | Střední | Redis `SET NX EX` distributed lock per ticketTypeId v DynamicPricingJob |
| Cold start na high-profile event → špatný benchmark | Nízká | Střední | Vrstva 1 konzervativního defaultu + promotér může nastavit manual initial price |
| Privacy: timing korelace → de-anonymizace session | Velmi nízká | Střední | Session ID je náhodný token bez link na user_id; experiment TTL 24h |
| Kafka lag → stale demand data | Nízká | Nízký | Demand signals jsou z DB, ne z Kafka → Kafka jen notifikace, ne data carrier |

---

## Výstupní lokace dokumentu

Tento dokument má být uložen jako:

```
C:\Users\omnia\Documents\tixly\ai-dynamic-pricing\ai-dynamic-pricing-architecture.md
```

Adresář `ai-dynamic-pricing` musí být vytvořen (neexistuje — task #73 implementaci zahájí jeho vytvořením).

---

### Critical Files for Implementation

- `C:/Users/omnia/Documents/tixly/pricing-engine/src/services/pricing.service.ts`
- `C:/Users/omnia/Documents/tixly/pricing-engine/src/types/pricing.ts`
- `C:/Users/omnia/Documents/tixly/pricing-engine/src/lib/pricing-calculator.ts`
- `C:/Users/omnia/Documents/tixly/pricing-engine/src/jobs/phase-checker.job.ts`
- `C:/Users/omnia/Documents/tixly/ticketing_schema.sql`