-- Bank Transfer Reconciliation — CZ varianta s variabilním symbolem.
--
-- orders.orders dostane sloupec variable_symbol (10 cifer). Při checkoutu s
-- paymentMethod='bank_transfer' se vygeneruje a zobrazí kupujícímu.
-- Admin pak paste CSV výpisu (nebo přes bank API integrace později) a tabulka
-- bank_transfer_imports zachytí incoming platby + automaticky páruje by VS+amount.

BEGIN;

ALTER TABLE orders.orders
  ADD COLUMN IF NOT EXISTS variable_symbol TEXT;

CREATE INDEX IF NOT EXISTS idx_orders_variable_symbol
  ON orders.orders (variable_symbol)
  WHERE variable_symbol IS NOT NULL;

CREATE TABLE orders.bank_transfer_imports (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  promoter_id     UUID         NOT NULL REFERENCES platform.promoters(id),
  uploaded_by     UUID         NOT NULL,
  source          TEXT         NOT NULL,  -- 'manual_csv', 'kb_api', 'cs_api', ...
  filename        TEXT,
  row_count       INTEGER      NOT NULL DEFAULT 0,
  matched_count   INTEGER      NOT NULL DEFAULT 0,
  unmatched_count INTEGER      NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE orders.bank_transfer_lines (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  import_id       UUID         REFERENCES orders.bank_transfer_imports(id) ON DELETE CASCADE,
  promoter_id     UUID         NOT NULL,
  amount_halire   INTEGER      NOT NULL,
  variable_symbol TEXT,
  payer_name      TEXT,
  message         TEXT,
  paid_at         TIMESTAMPTZ,
  matched_order_id UUID,
  match_status    TEXT         NOT NULL DEFAULT 'unmatched'
    CHECK (match_status IN ('unmatched', 'matched', 'manual_match', 'duplicate', 'rejected')),
  matched_at      TIMESTAMPTZ,
  raw_line        JSONB,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_bank_lines_vs
  ON orders.bank_transfer_lines (promoter_id, variable_symbol)
  WHERE match_status = 'unmatched';

CREATE INDEX idx_bank_lines_order
  ON orders.bank_transfer_lines (matched_order_id)
  WHERE matched_order_id IS NOT NULL;

COMMENT ON TABLE orders.bank_transfer_imports IS
  'Header per upload (CSV výpis, bank API). Sleduje totals pro audit.';
COMMENT ON TABLE orders.bank_transfer_lines IS
  'Jednotlivé incoming platby. Auto-match by VS+amount → marked paid order.';

COMMIT;
