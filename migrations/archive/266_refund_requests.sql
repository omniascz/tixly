-- Refund requests queue
--
-- Když kupec nemůže self-refund (po deadlinu, mimořádné okolnosti — nemoc,
-- karanténa, úmrtí v rodině), pošle žádost o refund. Promotér nebo Tixly
-- support ji schválí nebo zamítne s důvodem.
--
-- Workflow:
--   1. Kupec vyplní form (důvod, případně doklady)
--   2. Status='pending', notification do /admin pro promotéra
--   3. Promotér: approve → trigger refund flow (stejné jako self-service)
--                reject → status='rejected' + důvod, mail kupci
--   4. Po 14 dnech bez odpovědi: auto-eskalace na Tixly support

BEGIN;

CREATE TABLE IF NOT EXISTS orders.refund_requests (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id        UUID         NOT NULL REFERENCES orders.orders(id) ON DELETE RESTRICT,
  user_id         UUID         NOT NULL,  -- buyer (cross-schema)
  promoter_id     UUID         NOT NULL,
  status          TEXT         NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled', 'escalated')),
  reason          TEXT         NOT NULL,
  reason_category TEXT
    CHECK (reason_category IS NULL OR reason_category IN (
      'illness',           -- nemoc
      'family_emergency',  -- rodinná situace
      'travel_disruption', -- zrušený let / vlak
      'duplicate_purchase',-- omylem 2x koupil
      'event_changed',     -- promotér změnil
      'other'
    )),
  requested_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  reviewed_at     TIMESTAMPTZ,
  reviewed_by     UUID,        -- promotér member nebo Tixly admin
  reviewer_note   TEXT,        -- důvod approval/rejection
  refunded_halire INTEGER,     -- pokud approved: kolik se vrátilo
  ticket_ids      UUID[],      -- volitelné: kterých konkrétních lístků se týká
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE orders.refund_requests IS
  'Žádosti o refund mimo self-service okno. Promotér/support schvaluje manuálně.';

CREATE INDEX IF NOT EXISTS idx_refund_requests_promoter_status
  ON orders.refund_requests (promoter_id, status, requested_at DESC)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_refund_requests_order
  ON orders.refund_requests (order_id);

CREATE INDEX IF NOT EXISTS idx_refund_requests_user
  ON orders.refund_requests (user_id, requested_at DESC);

-- Trigger pro updated_at
DROP TRIGGER IF EXISTS trg_refund_requests_updated_at ON orders.refund_requests;
CREATE TRIGGER trg_refund_requests_updated_at
  BEFORE UPDATE ON orders.refund_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

COMMIT;
