CREATE TABLE IF NOT EXISTS ticket_payment_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_type_id UUID NOT NULL,
  promoter_id UUID NOT NULL,
  plan_type TEXT NOT NULL CHECK (plan_type IN ('split_3','split_6','split_12')),
  enabled BOOLEAN NOT NULL DEFAULT true,
  down_payment_percent INTEGER NOT NULL DEFAULT 33 CHECK (down_payment_percent BETWEEN 1 AND 100),
  issue_ticket_after TEXT NOT NULL DEFAULT 'first_payment' CHECK (issue_ticket_after IN ('first_payment','full_payment')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (ticket_type_id, plan_type)
);

CREATE TABLE IF NOT EXISTS ticket_installments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id UUID NOT NULL,
  order_id UUID NOT NULL,
  ticket_id UUID,
  plan_type TEXT NOT NULL,
  total_amount_halire INTEGER NOT NULL,
  paid_amount_halire INTEGER NOT NULL DEFAULT 0,
  remaining_halire INTEGER NOT NULL,
  installments JSONB NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed','defaulted','cancelled')),
  next_payment_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_ti_order ON ticket_installments(order_id);
CREATE INDEX idx_ti_status ON ticket_installments(status) WHERE status = 'active';
CREATE INDEX idx_ti_next_payment ON ticket_installments(next_payment_at) WHERE status = 'active';
