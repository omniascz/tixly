-- 071_bank_reconciliation.sql
-- Bank transfer payments ingested from Fio Banka API

CREATE SCHEMA IF NOT EXISTS payments;

CREATE TABLE IF NOT EXISTS payments.bank_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fio_transaction_id TEXT UNIQUE NOT NULL,
  amount_halire INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'CZK',
  variable_symbol TEXT,
  constant_symbol TEXT,
  specific_symbol TEXT,
  counter_account TEXT,
  counter_account_name TEXT,
  message TEXT,
  order_id TEXT,
  match_status TEXT NOT NULL DEFAULT 'unmatched',
  matched_by_user_id UUID,
  raw_payload JSONB,
  received_at TIMESTAMPTZ NOT NULL,
  matched_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bank_payments_vs ON payments.bank_payments(variable_symbol);
CREATE INDEX IF NOT EXISTS idx_bank_payments_match_status ON payments.bank_payments(match_status);
CREATE INDEX IF NOT EXISTS idx_bank_payments_order ON payments.bank_payments(order_id);
