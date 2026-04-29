-- =============================================================================
-- Migration 157: B2B Prodej na fakturu (Invoice Purchase)
-- Feature #182: Corporate ticket purchase flow:
--              reserve → proforma invoice → email → auto-cancel if unpaid
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS b2b_orders;

-- B2B order: invoice-based purchase (reserve now, pay later)
CREATE TABLE IF NOT EXISTS b2b_orders.invoice_orders (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  promoter_id         UUID NOT NULL,
  event_id            UUID NOT NULL REFERENCES catalog.events(id),
  company_name        TEXT NOT NULL,
  company_ico         TEXT NOT NULL,          -- Czech business ID
  company_address     TEXT NOT NULL,
  contact_name        TEXT NOT NULL,
  contact_email       TEXT NOT NULL,
  contact_phone       TEXT,
  invoice_number      TEXT UNIQUE,            -- generated on proforma issue
  ticket_items        JSONB NOT NULL DEFAULT '[]',  -- [{ticketTypeId, qty, unitPriceHellers}]
  total_amount_hellers BIGINT NOT NULL CHECK (total_amount_hellers > 0),
  vat_amount_hellers  BIGINT NOT NULL DEFAULT 0,
  currency            TEXT NOT NULL DEFAULT 'CZK',
  payment_due_days    INT NOT NULL DEFAULT 14 CHECK (payment_due_days BETWEEN 1 AND 90),
  due_date            DATE,                   -- calculated from confirmed_at + payment_due_days
  status              TEXT NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft', 'confirmed', 'proforma_sent', 'paid', 'cancelled', 'overdue')),
  proforma_pdf_url    TEXT,                   -- stored proforma invoice PDF
  payment_reference   TEXT,                   -- bank transfer VS symbol
  paid_at             TIMESTAMPTZ,
  cancelled_at        TIMESTAMPTZ,
  cancel_reason       TEXT,
  confirmed_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Reserved inventory for B2B orders (released if order cancelled/overdue)
CREATE TABLE IF NOT EXISTS b2b_orders.order_reservations (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id            UUID NOT NULL REFERENCES b2b_orders.invoice_orders(id),
  ticket_type_id      UUID NOT NULL,
  quantity            INT NOT NULL CHECK (quantity > 0),
  reserved_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  released_at         TIMESTAMPTZ             -- set when cancelled/expired
);

-- Dunning log: auto-cancel attempts and reminders
CREATE TABLE IF NOT EXISTS b2b_orders.dunning_log (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id            UUID NOT NULL REFERENCES b2b_orders.invoice_orders(id),
  action              TEXT NOT NULL CHECK (action IN ('reminder_sent', 'overdue_marked', 'auto_cancelled', 'manual_cancel')),
  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_b2b_orders_promoter ON b2b_orders.invoice_orders(promoter_id);
CREATE INDEX idx_b2b_orders_event ON b2b_orders.invoice_orders(event_id);
CREATE INDEX idx_b2b_orders_status ON b2b_orders.invoice_orders(status);
CREATE INDEX idx_b2b_orders_due ON b2b_orders.invoice_orders(due_date) WHERE status IN ('confirmed', 'proforma_sent');
CREATE INDEX idx_b2b_reservations_order ON b2b_orders.order_reservations(order_id);
