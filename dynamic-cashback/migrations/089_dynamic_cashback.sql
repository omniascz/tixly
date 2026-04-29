-- 089_dynamic_cashback.sql — schéma pro modul Dynamic Cashback & Loyalty 2.0.
-- Personalizovaná cashback sazba per uživatel, založená na tieru, RFM skóre
-- a segmentech. Všechny peněžní hodnoty v haléřích (INTEGER).

CREATE SCHEMA IF NOT EXISTS dynamic_cashback;

-- ---------------------------------------------------------------------------
-- Cache personalizovaných sazeb
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dynamic_cashback.rate_cache (
  user_id UUID NOT NULL,
  promoter_id UUID NOT NULL,
  effective_rate_bps INTEGER NOT NULL CHECK (effective_rate_bps >= 0 AND effective_rate_bps <= 2000),
  components JSONB NOT NULL,
  reasons JSONB,
  computed_at TIMESTAMPTZ DEFAULT NOW(),
  valid_until TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (user_id, promoter_id)
);
CREATE INDEX IF NOT EXISTS idx_rate_cache_valid
  ON dynamic_cashback.rate_cache(valid_until);

-- ---------------------------------------------------------------------------
-- Ledger — záznam každého přiznaného cashbacku
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dynamic_cashback.ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  promoter_id UUID NOT NULL,
  order_id TEXT NOT NULL,
  amount_halire INTEGER NOT NULL CHECK (amount_halire >= 0),
  rate_bps INTEGER NOT NULL CHECK (rate_bps >= 0 AND rate_bps <= 2000),
  components JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, order_id)
);
CREATE INDEX IF NOT EXISTS idx_cashback_ledger_user
  ON dynamic_cashback.ledger(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cashback_ledger_promoter
  ON dynamic_cashback.ledger(promoter_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Zůstatky uživatelů
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dynamic_cashback.balances (
  user_id UUID NOT NULL,
  promoter_id UUID NOT NULL,
  available_halire INTEGER NOT NULL DEFAULT 0 CHECK (available_halire >= 0),
  lifetime_earned_halire INTEGER NOT NULL DEFAULT 0 CHECK (lifetime_earned_halire >= 0),
  lifetime_redeemed_halire INTEGER NOT NULL DEFAULT 0 CHECK (lifetime_redeemed_halire >= 0),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, promoter_id)
);

-- ---------------------------------------------------------------------------
-- Per-promoter konfigurace (prahy, multiplikátory, cap)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dynamic_cashback.promoter_config (
  promoter_id UUID PRIMARY KEY,
  config JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- Per-event boost sazby (časově omezené)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dynamic_cashback.event_boosts (
  event_id UUID PRIMARY KEY,
  promoter_id UUID NOT NULL,
  boost_bps INTEGER NOT NULL CHECK (boost_bps >= 0 AND boost_bps <= 2000),
  valid_from TIMESTAMPTZ NOT NULL,
  valid_until TIMESTAMPTZ NOT NULL,
  CHECK (valid_until > valid_from)
);
CREATE INDEX IF NOT EXISTS idx_event_boosts_promoter
  ON dynamic_cashback.event_boosts(promoter_id);
CREATE INDEX IF NOT EXISTS idx_event_boosts_validity
  ON dynamic_cashback.event_boosts(valid_from, valid_until);
