-- Migration 028: CS notes table for audit trail
CREATE TABLE IF NOT EXISTS orders.cs_notes (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id   UUID NOT NULL REFERENCES orders.orders(id),
  agent_id   VARCHAR(100) NOT NULL,
  note       TEXT NOT NULL,
  action     VARCHAR(30) NOT NULL DEFAULT 'note',  -- note|refund|cancel|transfer
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX ON orders.cs_notes (order_id, created_at);
CREATE INDEX ON orders.cs_notes (agent_id, created_at);
