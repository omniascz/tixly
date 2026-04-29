-- Migration 108: Enhanced billing — VAT per line + credit notes
-- Transfer 5: Invoicing + VAT engine from Accounting → Tixly

-- Sequence for credit note numbers
CREATE SEQUENCE IF NOT EXISTS platform.credit_note_seq START 1;

-- Add VAT rate per line item (existing lines default to 21%)
ALTER TABLE platform.invoice_line_items
  ADD COLUMN IF NOT EXISTS vat_rate_percent SMALLINT NOT NULL DEFAULT 21,
  ADD COLUMN IF NOT EXISTS subtotal_halire INTEGER,
  ADD COLUMN IF NOT EXISTS vat_halire INTEGER;

-- Backfill: subtotal = total (was pre-vat), vat = computed from total
UPDATE platform.invoice_line_items
SET subtotal_halire = total_halire,
    vat_halire = ROUND(total_halire * 21.0 / 121.0)
WHERE subtotal_halire IS NULL;

-- Add tax_date and variable_symbol to invoices
ALTER TABLE platform.invoices
  ADD COLUMN IF NOT EXISTS tax_date DATE,
  ADD COLUMN IF NOT EXISTS variable_symbol TEXT;

-- Add 'reversed' status to invoices (for fully credited invoices)
ALTER TABLE platform.invoices
  DROP CONSTRAINT IF EXISTS invoices_status_check;
ALTER TABLE platform.invoices
  ADD CONSTRAINT invoices_status_check
  CHECK (status IN ('draft', 'issued', 'paid', 'overdue', 'void', 'reversed'));

-- Credit notes table
CREATE TABLE IF NOT EXISTS platform.credit_notes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  promoter_id     UUID NOT NULL REFERENCES platform.promoters(id),
  original_invoice_id UUID NOT NULL REFERENCES platform.invoices(id),
  credit_note_number  TEXT NOT NULL UNIQUE,
  reason          TEXT NOT NULL,
  subtotal_halire INTEGER NOT NULL CHECK (subtotal_halire >= 0),
  vat_halire      INTEGER NOT NULL CHECK (vat_halire >= 0),
  total_halire    INTEGER NOT NULL CHECK (total_halire >= 0),
  status          TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'issued', 'void')),
  issue_date      DATE NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_credit_notes_promoter
  ON platform.credit_notes(promoter_id, issue_date DESC);
CREATE INDEX IF NOT EXISTS idx_credit_notes_invoice
  ON platform.credit_notes(original_invoice_id);

-- Credit note line items
CREATE TABLE IF NOT EXISTS platform.credit_note_line_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  credit_note_id  UUID NOT NULL REFERENCES platform.credit_notes(id) ON DELETE CASCADE,
  description     TEXT NOT NULL,
  quantity        INTEGER NOT NULL DEFAULT 1,
  unit_price_halire INTEGER NOT NULL,
  vat_rate_percent  SMALLINT NOT NULL DEFAULT 21,
  subtotal_halire INTEGER NOT NULL,
  vat_halire      INTEGER NOT NULL,
  total_halire    INTEGER NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_credit_note_lines_cn
  ON platform.credit_note_line_items(credit_note_id);

-- RLS policies (promoter sees own credit notes, admin sees all)
ALTER TABLE platform.credit_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY credit_notes_promoter ON platform.credit_notes
  FOR SELECT USING (
    promoter_id = current_setting('app.tenant_id', TRUE)::UUID
    OR current_setting('app.role', TRUE) IN ('service', 'admin')
  );

CREATE POLICY credit_notes_admin_insert ON platform.credit_notes
  FOR INSERT WITH CHECK (
    current_setting('app.role', TRUE) IN ('service', 'admin')
  );

CREATE POLICY credit_notes_admin_update ON platform.credit_notes
  FOR UPDATE USING (
    current_setting('app.role', TRUE) IN ('service', 'admin')
  );

ALTER TABLE platform.credit_note_line_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY credit_note_lines_select ON platform.credit_note_line_items
  FOR SELECT USING (
    credit_note_id IN (
      SELECT id FROM platform.credit_notes
      WHERE promoter_id = current_setting('app.tenant_id', TRUE)::UUID
    )
    OR current_setting('app.role', TRUE) IN ('service', 'admin')
  );

CREATE POLICY credit_note_lines_admin ON platform.credit_note_line_items
  FOR ALL USING (
    current_setting('app.role', TRUE) IN ('service', 'admin')
  );
