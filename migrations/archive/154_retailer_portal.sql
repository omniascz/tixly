-- =============================================================================
-- Migration 154: Retailer Partner Portal
-- Feature #189: Network of physical retail points (kiosks, bookstores, newsstands)
--              Retailer onboarding + inventory allocation + commission tracking
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS retailer;

-- Retailer: a physical point-of-sale partner
CREATE TABLE IF NOT EXISTS retailer.retailers (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                TEXT NOT NULL,
  contact_name        TEXT NOT NULL,
  contact_email       TEXT NOT NULL UNIQUE,
  contact_phone       TEXT,
  address             TEXT,
  city                TEXT NOT NULL,
  country             TEXT NOT NULL DEFAULT 'CZ',
  ico                 TEXT,                   -- Czech business ID
  commission_pct      DECIMAL(5,2) NOT NULL DEFAULT 5.00 CHECK (commission_pct >= 0 AND commission_pct <= 30),
  api_key             TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(24), 'hex'),
  status              TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'terminated')),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Inventory allocation: how many tickets a retailer can sell per ticket type
CREATE TABLE IF NOT EXISTS retailer.inventory_allocations (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  retailer_id         UUID NOT NULL REFERENCES retailer.retailers(id),
  event_id            UUID NOT NULL REFERENCES catalog.events(id),
  ticket_type_id      UUID NOT NULL,
  allocated_qty       INT NOT NULL CHECK (allocated_qty >= 0),
  sold_qty            INT NOT NULL DEFAULT 0 CHECK (sold_qty >= 0),
  returned_qty        INT NOT NULL DEFAULT 0 CHECK (returned_qty >= 0),
  valid_from          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  valid_until         TIMESTAMPTZ,
  UNIQUE (retailer_id, ticket_type_id)
);

-- Retailer sales: each ticket sold through a retailer
CREATE TABLE IF NOT EXISTS retailer.retailer_sales (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  retailer_id         UUID NOT NULL REFERENCES retailer.retailers(id),
  allocation_id       UUID NOT NULL REFERENCES retailer.inventory_allocations(id),
  ticket_id           UUID NOT NULL,
  order_id            UUID,
  sale_price_hellers  INT NOT NULL CHECK (sale_price_hellers > 0),
  commission_hellers  INT NOT NULL DEFAULT 0,
  sold_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  settlement_id       UUID                    -- linked settlement batch
);

-- Daily settlements: end-of-day reconciliation per retailer
CREATE TABLE IF NOT EXISTS retailer.settlements (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  retailer_id         UUID NOT NULL REFERENCES retailer.retailers(id),
  settlement_date     DATE NOT NULL,
  total_sales         INT NOT NULL DEFAULT 0,
  gross_amount_hellers BIGINT NOT NULL DEFAULT 0,
  commission_hellers  BIGINT NOT NULL DEFAULT 0,
  net_amount_hellers  BIGINT NOT NULL DEFAULT 0,  -- owed to platform
  status              TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'invoiced', 'paid')),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (retailer_id, settlement_date)
);

CREATE INDEX idx_retailer_allocations_retailer ON retailer.inventory_allocations(retailer_id);
CREATE INDEX idx_retailer_allocations_event ON retailer.inventory_allocations(event_id);
CREATE INDEX idx_retailer_sales_retailer ON retailer.retailer_sales(retailer_id);
CREATE INDEX idx_retailer_sales_ticket ON retailer.retailer_sales(ticket_id);
CREATE INDEX idx_retailer_settlements_retailer ON retailer.settlements(retailer_id, settlement_date);
