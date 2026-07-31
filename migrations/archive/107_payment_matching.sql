-- 107_payment_matching.sql
-- Rozsireni bank reconciliation o 4-level payment matching (z accounting projektu)

BEGIN;

-- Rozsireni match_status o nove stavy
-- (existujici: unmatched, matched, overpaid, underpaid, manual_review)
-- Pridano: partial_match, multi_match
ALTER TABLE payments.bank_payments
  DROP CONSTRAINT IF EXISTS bank_payments_match_status_check;

ALTER TABLE payments.bank_payments
  ADD CONSTRAINT bank_payments_match_status_check
  CHECK (match_status IN (
    'unmatched', 'matched', 'partial_match',
    'overpaid', 'underpaid', 'multi_match', 'manual_review'
  ));

-- Match confidence metadata (JSON s detaily matchingu)
ALTER TABLE payments.bank_payments
  ADD COLUMN IF NOT EXISTS match_confidence JSONB DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS match_level SMALLINT DEFAULT NULL;

COMMENT ON COLUMN payments.bank_payments.match_confidence IS 'JSON: {score, level, reasons[], candidates[]}';
COMMENT ON COLUMN payments.bank_payments.match_level IS 'Match level 1-4: 1=exact VS, 2=VS+amount diff, 3=fuzzy, 4=AI';

-- Audit log pro vsechny matchingy
CREATE TABLE IF NOT EXISTS payments.payment_match_log (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_payment_id UUID        NOT NULL REFERENCES payments.bank_payments(id),
  order_id        UUID        NOT NULL,
  match_level     SMALLINT    NOT NULL CHECK (match_level BETWEEN 1 AND 4),
  match_score     NUMERIC(5,4) NOT NULL,    -- 0.0000 - 1.0000
  matched_amount  INTEGER     NOT NULL,     -- halire
  was_auto        BOOLEAN     NOT NULL DEFAULT false,
  matched_by      UUID        DEFAULT NULL, -- user_id pro manual match
  metadata        JSONB       DEFAULT '{}'::jsonb,
  matched_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS payment_match_log_payment_idx
  ON payments.payment_match_log (bank_payment_id);

CREATE INDEX IF NOT EXISTS payment_match_log_order_idx
  ON payments.payment_match_log (order_id);

CREATE INDEX IF NOT EXISTS payment_match_log_date_idx
  ON payments.payment_match_log (matched_at);

COMMENT ON TABLE payments.payment_match_log IS 'Audit log pro bank-to-order matching. Kazdy zaznam = 1 matchovaci pokus.';

COMMIT;
