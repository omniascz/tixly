-- =============================================================================
-- Migration 140: Order Currency Locking — Multi-Currency Checkout
-- Feature #29: Store locked exchange rates per order for audit and refunds
-- =============================================================================

-- Locked exchange rate per order at checkout creation
CREATE TABLE IF NOT EXISTS orders.order_currencies (
  order_id                UUID PRIMARY KEY REFERENCES orders.orders(id),
  base_currency           TEXT NOT NULL DEFAULT 'CZK',
  base_amount_hellers     INT NOT NULL,
  target_currency         TEXT NOT NULL,
  target_amount_subunits  INT NOT NULL,
  exchange_rate           DECIMAL(18,8) NOT NULL,
  rate_date               DATE NOT NULL,
  rate_locked_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for reporting
CREATE INDEX idx_order_currencies_target ON orders.order_currencies(target_currency);
CREATE INDEX idx_order_currencies_rate_date ON orders.order_currencies(rate_date);
