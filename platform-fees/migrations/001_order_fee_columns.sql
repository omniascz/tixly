-- Migration: 001_order_fee_columns
-- Přidat platform fee sloupce do orders.orders a orders.order_items
-- + pohled platform.revenue_summary pro finanční reporting

-- ---------------------------------------------------------------------------
-- orders.orders — přidat fee sloupce
-- ---------------------------------------------------------------------------
ALTER TABLE orders.orders
  ADD COLUMN IF NOT EXISTS platform_fee_amount  INTEGER NOT NULL DEFAULT 0
    CHECK (platform_fee_amount >= 0),
  ADD COLUMN IF NOT EXISTS promoter_payout      INTEGER
    GENERATED ALWAYS AS (total_amount - platform_fee_amount) STORED,
  ADD COLUMN IF NOT EXISTS fee_schedule_id      UUID;

-- Index pro reporting podle fee schedule
CREATE INDEX IF NOT EXISTS idx_orders_fee_schedule
  ON orders.orders(fee_schedule_id)
  WHERE fee_schedule_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- orders.order_items — přidat per-ticket fee breakdown
-- ---------------------------------------------------------------------------
ALTER TABLE orders.order_items
  ADD COLUMN IF NOT EXISTS platform_fee_amount  INTEGER NOT NULL DEFAULT 0
    CHECK (platform_fee_amount >= 0),
  ADD COLUMN IF NOT EXISTS promoter_payout      INTEGER
    GENERATED ALWAYS AS (subtotal - platform_fee_amount) STORED;

-- ---------------------------------------------------------------------------
-- Pohled pro finanční reporting platformy
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW platform.revenue_summary AS
SELECT
  DATE_TRUNC('day', o.created_at)   AS day,
  o.promoter_id,
  COUNT(DISTINCT o.id)               AS order_count,
  SUM(o.total_amount)                AS gross_revenue,
  SUM(o.platform_fee_amount)         AS platform_fees,
  SUM(o.promoter_payout)             AS promoter_payouts,
  o.currency
FROM orders.orders o
WHERE o.status = 'paid'
GROUP BY DATE_TRUNC('day', o.created_at), o.promoter_id, o.currency;
