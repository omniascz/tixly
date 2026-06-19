BEGIN;

CREATE TABLE IF NOT EXISTS catalog.event_reschedules (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  original_event_id UUID NOT NULL REFERENCES catalog.events(id) ON DELETE CASCADE,
  new_event_id      UUID REFERENCES catalog.events(id),
  promoter_id       UUID NOT NULL REFERENCES platform.promoters(id),
  reason            TEXT NOT NULL,
  offer_refund      BOOLEAN NOT NULL DEFAULT true,
  response_deadline TIMESTAMPTZ NOT NULL DEFAULT NOW() + interval '72 hours',
  sent_at           TIMESTAMPTZ,
  recipient_count   INT,
  accepted_count    INT NOT NULL DEFAULT 0,
  refund_count      INT NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS orders.reschedule_responses (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reschedule_id  UUID NOT NULL REFERENCES catalog.event_reschedules(id) ON DELETE CASCADE,
  order_id       UUID NOT NULL REFERENCES orders.orders(id),
  response_token TEXT UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(16), 'hex'),
  response       TEXT CHECK (response IN ('accepted','refund_requested')),
  responded_at   TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (reschedule_id, order_id)
);

CREATE INDEX IF NOT EXISTS idx_reschedule_original ON catalog.event_reschedules(original_event_id);
CREATE INDEX IF NOT EXISTS idx_reschedule_resp_token ON orders.reschedule_responses(response_token);

COMMIT;
