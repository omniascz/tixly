BEGIN;

CREATE TABLE IF NOT EXISTS platform.b2b_accounts (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name          TEXT NOT NULL,
  ico                   TEXT NOT NULL,
  dic                   TEXT,
  contact_email         TEXT NOT NULL,
  billing_email         TEXT,
  credit_balance_halire BIGINT NOT NULL DEFAULT 0 CHECK (credit_balance_halire >= 0),
  monthly_limit_halire  BIGINT,
  status                TEXT NOT NULL DEFAULT 'active'
                          CHECK (status IN ('active','suspended')),
  account_code          TEXT UNIQUE NOT NULL DEFAULT upper(encode(gen_random_bytes(4), 'hex')),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS platform.b2b_account_users (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id           UUID NOT NULL REFERENCES platform.b2b_accounts(id) ON DELETE CASCADE,
  email                TEXT NOT NULL,
  name                 TEXT NOT NULL,
  monthly_limit_halire BIGINT,
  is_admin             BOOLEAN NOT NULL DEFAULT false,
  invite_token         TEXT UNIQUE DEFAULT encode(gen_random_bytes(16), 'hex'),
  invited_at           TIMESTAMPTZ,
  joined_at            TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (account_id, email)
);

CREATE TABLE IF NOT EXISTS platform.b2b_transactions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      UUID NOT NULL REFERENCES platform.b2b_accounts(id),
  user_id         UUID REFERENCES platform.b2b_account_users(id),
  type            TEXT NOT NULL CHECK (type IN ('deposit','purchase','refund','adjustment')),
  amount_halire   BIGINT NOT NULL,
  balance_after   BIGINT NOT NULL,
  order_id        UUID REFERENCES orders.orders(id),
  note            TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_b2b_tx_account ON platform.b2b_transactions(account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_b2b_users_account ON platform.b2b_account_users(account_id);

COMMIT;
