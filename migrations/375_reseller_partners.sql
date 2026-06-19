BEGIN;

CREATE TABLE IF NOT EXISTS platform.reseller_partners (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  contact_email   TEXT NOT NULL UNIQUE,
  contact_phone   TEXT,
  address         TEXT,
  city            TEXT,
  password_hash   TEXT NOT NULL,
  commission_pct  NUMERIC(5,2) NOT NULL DEFAULT 10.00 CHECK (commission_pct BETWEEN 0 AND 50),
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','active','suspended')),
  api_key         TEXT UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_login_at   TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS orders.reseller_sales (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id              UUID NOT NULL REFERENCES platform.reseller_partners(id),
  order_id                UUID NOT NULL REFERENCES orders.orders(id) UNIQUE,
  commission_pct          NUMERIC(5,2) NOT NULL,
  commission_amount_halire INT NOT NULL DEFAULT 0,
  settled_at              TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reseller_sales_partner ON orders.reseller_sales(partner_id);
CREATE INDEX IF NOT EXISTS idx_reseller_sales_settled ON orders.reseller_sales(settled_at) WHERE settled_at IS NULL;

COMMIT;
