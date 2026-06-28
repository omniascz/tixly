-- Migration 390: EU B2B reverse charge + OSS/threshold support
-- Adds buyer VAT number, company name, and reverse charge flag to orders.
-- Used when a business buyer provides an EU VAT ID → 0% VAT (reverse charge).

-- New columns on orders.orders
ALTER TABLE orders.orders
  ADD COLUMN IF NOT EXISTS buyer_vat_number   TEXT,          -- EU VAT ID (e.g. "DE123456789")
  ADD COLUMN IF NOT EXISTS buyer_company_name TEXT,          -- legal company name for B2B invoice
  ADD COLUMN IF NOT EXISTS is_reverse_charge  BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS oss_rate_pct       NUMERIC(5,2);  -- non-null = OSS rate applied (buyer country rate)

-- Index for B2B order lookup (finance team, VIES audit)
CREATE INDEX IF NOT EXISTS orders_buyer_vat_number_idx
  ON orders.orders (buyer_vat_number)
  WHERE buyer_vat_number IS NOT NULL;

-- VIES validation audit log
CREATE TABLE IF NOT EXISTS platform.vies_checks (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  checked_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  vat_number     TEXT NOT NULL,
  country_code   CHAR(2) NOT NULL,
  is_valid       BOOLEAN NOT NULL,
  company_name   TEXT,
  address        TEXT,
  order_id       UUID REFERENCES orders.orders(id) ON DELETE SET NULL,
  promoter_id    UUID REFERENCES platform.promoters(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS vies_checks_vat_number_idx ON platform.vies_checks (vat_number);
CREATE INDEX IF NOT EXISTS vies_checks_order_id_idx   ON platform.vies_checks (order_id);

-- RLS: promoter sees their own checks
ALTER TABLE platform.vies_checks ENABLE ROW LEVEL SECURITY;
CREATE POLICY vies_checks_promoter ON platform.vies_checks
  FOR ALL TO authenticated
  USING (promoter_id = (SELECT promoter_id FROM platform.users_promoters WHERE user_id = auth.uid() LIMIT 1));
