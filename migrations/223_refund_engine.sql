CREATE TABLE IF NOT EXISTS refunds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL,
  promoter_id UUID NOT NULL,
  amount_halire INTEGER NOT NULL CHECK (amount_halire > 0),
  reason TEXT NOT NULL,
  requested_by TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','completed','failed')),
  payment_gateway TEXT NOT NULL,
  gateway_refund_id TEXT,
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_refunds_order ON refunds(order_id);
CREATE INDEX idx_refunds_promoter ON refunds(promoter_id);
CREATE INDEX idx_refunds_status ON refunds(status) WHERE status = 'pending';
