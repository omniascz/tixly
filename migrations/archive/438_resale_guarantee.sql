-- Migration 438: Fan Guarantee pro Resale
-- Tixly garantuje autenticitu resale vstupenky — pokud je neplatná, vrátí peníze.

-- ─── Resale listing — přidáme guarantee příznaky (tabulka existuje z mig 404) ──
ALTER TABLE orders.resale_listings ADD COLUMN IF NOT EXISTS guarantee_enabled boolean NOT NULL DEFAULT false;

ALTER TABLE orders.resale_listings ADD COLUMN IF NOT EXISTS guarantee_fee_pct numeric(5,2) NOT NULL DEFAULT 5.0;

-- ─── Promotér — jestli má aktivní guarantee program ───────────────────────────
ALTER TABLE platform.promoters ADD COLUMN IF NOT EXISTS resale_guarantee_active boolean NOT NULL DEFAULT false;

-- ─── Guarantee claims ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS orders.resale_guarantee_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resale_listing_id uuid NOT NULL REFERENCES orders.resale_listings(id),
  buyer_order_id uuid NOT NULL REFERENCES orders.orders(id),
  reporter_user_id uuid REFERENCES identity.users(id),
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  resolution text,
  resolved_at timestamptz,
  refund_amount_halire bigint,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS rgc_listing_idx ON orders.resale_guarantee_claims (resale_listing_id);

CREATE INDEX IF NOT EXISTS rgc_buyer_order_idx ON orders.resale_guarantee_claims (buyer_order_id);

CREATE INDEX IF NOT EXISTS rgc_status_idx ON orders.resale_guarantee_claims (status, created_at DESC);

ALTER TABLE orders.resale_guarantee_claims ENABLE ROW LEVEL SECURITY;

CREATE POLICY rgc_owner ON orders.resale_guarantee_claims
  FOR SELECT
  USING (reporter_user_id::text = current_setting('app.current_user_id', true));

CREATE POLICY rgc_admin ON orders.resale_guarantee_claims
  FOR ALL
  USING (current_setting('app.is_platform_admin', true) = 'true');
