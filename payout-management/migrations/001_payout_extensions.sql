-- Nastavení výplatního cyklu per promotér
CREATE TABLE platform.payout_settings (
  promoter_id         UUID PRIMARY KEY REFERENCES platform.promoters(id) ON DELETE CASCADE,
  payout_cycle        TEXT NOT NULL DEFAULT 'post_event'
    CHECK (payout_cycle IN ('daily', 'weekly', 'monthly', 'post_event', 'manual')),
  rolling_reserve_pct INTEGER NOT NULL DEFAULT 500    -- 500 = 5.00 %
    CHECK (rolling_reserve_pct BETWEEN 0 AND 5000),
  reserve_release_days INTEGER NOT NULL DEFAULT 30,   -- po kolika dnech se reserve uvolní
  min_payout_amount   INTEGER NOT NULL DEFAULT 10000, -- min. výplata (100 Kč)
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Rolling reserve záznamy (co je zadrženo a kdy se uvolní)
CREATE TABLE platform.rolling_reserves (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  promoter_id       UUID NOT NULL REFERENCES platform.promoters(id),
  payout_id         UUID REFERENCES platform.payouts(id),
  amount            INTEGER NOT NULL CHECK (amount > 0),  -- haléře
  release_date      DATE NOT NULL,
  released          BOOLEAN NOT NULL DEFAULT FALSE,
  released_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_reserves_promoter ON platform.rolling_reserves(promoter_id, released);
CREATE INDEX idx_reserves_release ON platform.rolling_reserves(release_date) WHERE released = FALSE;

-- Settlement per event (detailní rozúčtování)
CREATE TABLE platform.event_settlements (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id          UUID NOT NULL,
  promoter_id       UUID NOT NULL REFERENCES platform.promoters(id),
  payout_id         UUID REFERENCES platform.payouts(id),
  -- Tržby
  tickets_sold      INTEGER NOT NULL DEFAULT 0,
  gross_revenue     INTEGER NOT NULL DEFAULT 0 CHECK (gross_revenue >= 0),
  platform_fees     INTEGER NOT NULL DEFAULT 0 CHECK (platform_fees >= 0),
  -- Odečty
  refunds_count     INTEGER NOT NULL DEFAULT 0,
  refunds_amount    INTEGER NOT NULL DEFAULT 0 CHECK (refunds_amount >= 0),
  chargebacks_count INTEGER NOT NULL DEFAULT 0,
  chargebacks_amount INTEGER NOT NULL DEFAULT 0 CHECK (chargebacks_amount >= 0),
  -- Výsledek
  net_revenue       INTEGER NOT NULL,  -- gross - fees - refunds - chargebacks
  -- Stav
  settled           BOOLEAN NOT NULL DEFAULT FALSE,
  settled_at        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_event_settlement UNIQUE (event_id, promoter_id)
);
CREATE INDEX idx_event_settlements_promoter ON platform.event_settlements(promoter_id, settled);
CREATE INDEX idx_event_settlements_payout ON platform.event_settlements(payout_id);

-- Payout audit log
CREATE TABLE platform.payout_events (
  id            BIGSERIAL PRIMARY KEY,
  payout_id     UUID NOT NULL REFERENCES platform.payouts(id),
  event_type    VARCHAR(50) NOT NULL,  -- 'created', 'approved', 'processing', 'paid', 'failed', 'retried'
  actor_user_id UUID,
  details       JSONB NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_payout_events_payout ON platform.payout_events(payout_id, created_at DESC);

-- Rozšíření platform.payouts o settlement reference
ALTER TABLE platform.payouts
  ADD COLUMN IF NOT EXISTS payout_cycle TEXT,
  ADD COLUMN IF NOT EXISTS failure_reason TEXT,
  ADD COLUMN IF NOT EXISTS retry_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS approved_by UUID,
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
