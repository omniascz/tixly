-- Migration 102: Billing / invoices
-- Monthly invoice records for platform fees charged to promoters.

CREATE TABLE IF NOT EXISTS platform.invoices (
  id                    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  promoter_id           UUID          NOT NULL,
  -- Human-readable: INV-2026-04-0001
  invoice_number        TEXT          NOT NULL UNIQUE,
  period_from           DATE          NOT NULL,
  period_to             DATE          NOT NULL,
  -- Total gross revenue for the period (halire)
  gross_revenue_halire  INTEGER       NOT NULL DEFAULT 0 CHECK (gross_revenue_halire >= 0),
  -- Platform fees due (halire)
  platform_fees_halire  INTEGER       NOT NULL DEFAULT 0 CHECK (platform_fees_halire >= 0),
  -- VAT 21% on platform fees (halire)
  vat_halire            INTEGER       NOT NULL DEFAULT 0 CHECK (vat_halire >= 0),
  -- Total amount due = platform_fees + vat (halire)
  total_halire          INTEGER       NOT NULL DEFAULT 0 CHECK (total_halire >= 0),
  -- draft → issued → paid | void | overdue
  status                TEXT          NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft', 'issued', 'paid', 'overdue', 'void')),
  due_date              DATE          NOT NULL,
  paid_at               TIMESTAMPTZ,
  notes                 TEXT,
  created_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  CONSTRAINT invoice_period_check CHECK (period_to >= period_from)
);

CREATE INDEX ON platform.invoices (promoter_id, period_from DESC);
CREATE INDEX ON platform.invoices (status, due_date);

CREATE TABLE IF NOT EXISTS platform.invoice_line_items (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id        UUID        NOT NULL REFERENCES platform.invoices(id) ON DELETE CASCADE,
  description       TEXT        NOT NULL,
  quantity          INTEGER     NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price_halire INTEGER     NOT NULL CHECK (unit_price_halire >= 0),
  total_halire      INTEGER     NOT NULL CHECK (total_halire >= 0),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX ON platform.invoice_line_items (invoice_id);

-- Sequence for human-readable invoice numbers
CREATE SEQUENCE IF NOT EXISTS platform.invoice_seq START 1;
