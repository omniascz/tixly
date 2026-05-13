-- Refund policy per promotér
CREATE TYPE platform.refund_policy_type AS ENUM (
  'no_refund',        -- žádné refundace
  'full_refund',      -- plná refundace (100%)
  'partial_refund',   -- částečná (konfigurovatelné %)
  'tiered_refund',    -- podle časového pásma před akcí
  'credit_only'       -- vrácení jako kredit/voucher, ne peníze
);

CREATE TYPE platform.refund_method AS ENUM (
  'original_payment',  -- zpět na kartu/účet
  'platform_credit',   -- kredit na platformě
  'both_allowed'       -- kupující si vybere
);

CREATE TABLE platform.refund_policies (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  promoter_id         UUID NOT NULL REFERENCES platform.promoters(id) ON DELETE CASCADE,
  name                VARCHAR(100) NOT NULL DEFAULT 'Výchozí politika',
  policy_type         platform.refund_policy_type NOT NULL DEFAULT 'no_refund',
  -- Procento vrácení (pro partial_refund): 0–10000 (500 = 5.00 %, 10000 = 100 %)
  refund_percentage   INTEGER CHECK (refund_percentage BETWEEN 0 AND 10000),
  -- Refund method
  refund_method       platform.refund_method NOT NULL DEFAULT 'original_payment',
  -- Self-service: kupující může refundovat sám (bez support ticketu)
  allow_self_service  BOOLEAN NOT NULL DEFAULT FALSE,
  -- Minimální počet dní před akcí pro refund (NULL = kdykoli)
  min_days_before_event INTEGER CHECK (min_days_before_event >= 0),
  -- Maximální počet dní po nákupu pro refund (NULL = bez limitu)
  max_days_after_purchase INTEGER CHECK (max_days_after_purchase >= 0),
  -- Platí pro všechny eventy promotéra (výchozí politika)
  is_default          BOOLEAN NOT NULL DEFAULT TRUE,
  is_active           BOOLEAN NOT NULL DEFAULT TRUE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_promoter_default_policy UNIQUE (promoter_id, is_default)
    DEFERRABLE INITIALLY DEFERRED
);

-- Časová pásma pro tiered_refund
-- Příklad: 30+ dní před akcí = 100%, 14–29 dní = 75%, 7–13 dní = 50%, < 7 dní = 0%
CREATE TABLE platform.refund_policy_tiers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_id       UUID NOT NULL REFERENCES platform.refund_policies(id) ON DELETE CASCADE,
  -- Počet dní před akcí (min_days <= daysBeforeEvent < next tier's min_days)
  min_days_before INTEGER NOT NULL CHECK (min_days_before >= 0),
  -- Procento refundace pro toto pásmo
  refund_pct      INTEGER NOT NULL CHECK (refund_pct BETWEEN 0 AND 10000),
  -- Popis pásma pro zobrazení kupujícímu
  label           VARCHAR(100),  -- "Více než 30 dní před akcí"
  sort_order      INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT uq_policy_tier_days UNIQUE (policy_id, min_days_before)
);

-- Override per event (promotér může nastavit jiné podmínky pro konkrétní akci)
CREATE TABLE platform.event_refund_overrides (
  event_id        UUID PRIMARY KEY,
  promoter_id     UUID NOT NULL REFERENCES platform.promoters(id),
  policy_id       UUID NOT NULL REFERENCES platform.refund_policies(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Refund žádosti (když allow_self_service = FALSE, kupující podá žádost)
CREATE TYPE platform.refund_request_status AS ENUM (
  'pending', 'approved', 'rejected', 'processed'
);

CREATE TABLE platform.refund_requests (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id        UUID NOT NULL,
  ticket_id       UUID,           -- NULL = celá objednávka
  promoter_id     UUID NOT NULL REFERENCES platform.promoters(id),
  user_id         UUID NOT NULL,
  reason          TEXT NOT NULL,
  requested_amount INTEGER,       -- NULL = plná refundace dle policy
  status          platform.refund_request_status NOT NULL DEFAULT 'pending',
  -- Rozhodnutí
  decided_by      UUID,           -- admin nebo promotér
  decided_at      TIMESTAMPTZ,
  decision_notes  TEXT,
  -- Výsledek
  refunded_amount INTEGER,        -- haléře — skutečně vráceno
  refund_method   platform.refund_method,
  processed_at    TIMESTAMPTZ,
  idempotency_key UUID NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_refund_request_idempotency UNIQUE (idempotency_key)
);

CREATE INDEX idx_refund_policies_promoter ON platform.refund_policies(promoter_id, is_active);
CREATE INDEX idx_refund_requests_order ON platform.refund_requests(order_id, status);
CREATE INDEX idx_refund_requests_promoter ON platform.refund_requests(promoter_id, status);
CREATE INDEX idx_refund_requests_user ON platform.refund_requests(user_id, status);
CREATE INDEX idx_event_overrides_promoter ON platform.event_refund_overrides(promoter_id);
