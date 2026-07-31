-- 106_multi_currency.sql
-- Multi-currency support: currencies + exchange_rates
-- Adaptovano z accounting projektu pro tixly

BEGIN;

-- Tabulka podporovanych men
CREATE TABLE IF NOT EXISTS platform.currencies (
  code        CHAR(3)     PRIMARY KEY,            -- ISO 4217
  name        VARCHAR(64) NOT NULL,
  symbol      VARCHAR(8)  NOT NULL DEFAULT '',     -- €, $, £, zł, Kč
  decimals    SMALLINT    NOT NULL DEFAULT 2,      -- pocet des. mist (JPY=0, CZK/EUR/USD=2)
  subunit     SMALLINT    NOT NULL DEFAULT 100,    -- 10^decimals — kolik subunitu v 1 jednotce
  is_active   BOOLEAN     NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE platform.currencies IS 'ISO 4217 meny podporovane platformou';
COMMENT ON COLUMN platform.currencies.subunit IS '10^decimals: CZK=100 (halere), JPY=1, BHD=1000';

-- Seed: meny pro CZ/SK/EU expanzi
INSERT INTO platform.currencies (code, name, symbol, decimals, subunit) VALUES
  ('CZK', 'Ceska koruna',    'Kc', 2, 100),
  ('EUR', 'Euro',            '€',  2, 100),
  ('USD', 'US Dollar',       '$',  2, 100),
  ('GBP', 'British Pound',   '£',  2, 100),
  ('PLN', 'Polish Zloty',    'zl', 2, 100),
  ('HUF', 'Hungarian Forint','Ft', 2, 100),
  ('CHF', 'Swiss Franc',     'Fr', 2, 100),
  ('SEK', 'Swedish Krona',   'kr', 2, 100),
  ('NOK', 'Norwegian Krone', 'kr', 2, 100),
  ('DKK', 'Danish Krone',    'kr', 2, 100),
  ('JPY', 'Japanese Yen',    '¥',  0, 1)
ON CONFLICT (code) DO NOTHING;

-- Denni kurzy z CNB / ECB
CREATE TABLE IF NOT EXISTS platform.exchange_rates (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  rate_date   DATE        NOT NULL,
  base        CHAR(3)     NOT NULL,               -- mena vychozi (CZK pro CNB, EUR pro ECB)
  quote       CHAR(3)     NOT NULL,               -- cilova mena
  rate        NUMERIC(19,8) NOT NULL,              -- kolik base za 1 quote
  source      VARCHAR(16) NOT NULL DEFAULT 'CNB',  -- CNB, ECB, MANUAL
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS exchange_rates_uq
  ON platform.exchange_rates (rate_date, base, quote, source);

CREATE INDEX IF NOT EXISTS exchange_rates_date_idx
  ON platform.exchange_rates (rate_date);

COMMENT ON TABLE platform.exchange_rates IS 'Denni kurzy — CNB (CZK-based), ECB (EUR-based)';
COMMENT ON COLUMN platform.exchange_rates.rate IS 'Kolik jednotek base za 1 jednotku quote. Napr. CZK/EUR = 25.21 → 1 EUR = 25.21 CZK';

COMMIT;
