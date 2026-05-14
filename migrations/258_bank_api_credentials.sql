-- Bank API credentials per promotér (read-only tokeny).
--
-- Fio Bank: token z internet bankingu (read-only access)
-- KB: PSD2 / OAuth2 (refresh token uložen)
-- ČS: PSD2 / OAuth2
--
-- Encrypted at rest přes existing crypto helper (AES-256-GCM).

BEGIN;

CREATE TABLE platform.bank_credentials (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  promoter_id     UUID         NOT NULL REFERENCES platform.promoters(id) ON DELETE CASCADE,
  provider        TEXT         NOT NULL
    CHECK (provider IN ('fio', 'kb_psd2', 'cs_psd2', 'csob_psd2', 'air_bank')),
  token_encrypted TEXT         NOT NULL,         -- base64 AES-256-GCM bundle
  account_iban    TEXT,
  last_sync_at    TIMESTAMPTZ,
  last_sync_status TEXT,                          -- 'ok' | 'failed: <reason>'
  active          BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_bank_creds_promoter_provider UNIQUE (promoter_id, provider)
);

CREATE INDEX idx_bank_creds_promoter
  ON platform.bank_credentials (promoter_id)
  WHERE active = TRUE;

COMMENT ON TABLE platform.bank_credentials IS
  'Read-only bank tokeny pro auto-pull výpisů. Cron volá podle provideru a páruje incoming platby s pending orders.';

COMMIT;
