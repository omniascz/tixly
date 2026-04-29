-- =============================================================================
-- MIGRACE 090: Schéma pro referral-system modul
-- Datum: 2026-04-08
-- Modul: C:\Users\omnia\Documents\tixly\referral-system\
-- Tabulky: referral.links, referral.clicks, referral.conversions,
--          referral.credit_wallet, referral.credit_transactions,
--          referral.dual_rewards
--
-- Poznámka:
--   Existující services používají CZK sloupce (amount_czk, earned_czk, ...)
--   zatímco dual-reward.service používá halíře (amount_halire). Tabulka
--   referral.credit_transactions proto obsahuje OBA sloupce — jeden
--   nullable. TODO: sjednotit na halíře (INTEGER) v P1.
-- =============================================================================

BEGIN;

CREATE SCHEMA IF NOT EXISTS referral;

-- ---------------------------------------------------------------------------
-- referral.links — referral odkazy uživatelů
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS referral.links (
  id                 UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  -- cross-schema ref na identity.users — bez FK
  user_id            UUID         NOT NULL,
  code               VARCHAR(16)  NOT NULL UNIQUE,
  campaign_id        UUID         NULL,
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  is_active          BOOLEAN      NOT NULL DEFAULT TRUE,
  total_clicks       INTEGER      NOT NULL DEFAULT 0 CHECK (total_clicks >= 0),
  total_conversions  INTEGER      NOT NULL DEFAULT 0 CHECK (total_conversions >= 0),
  -- Celková zasloužená provize v CZK (s desetinami kvůli kompatibilitě services)
  total_earned_czk   NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (total_earned_czk >= 0)
);

CREATE INDEX IF NOT EXISTS idx_referral_links_user_id   ON referral.links(user_id);
CREATE INDEX IF NOT EXISTS idx_referral_links_code      ON referral.links(code);
CREATE INDEX IF NOT EXISTS idx_referral_links_campaign  ON referral.links(campaign_id);
CREATE INDEX IF NOT EXISTS idx_referral_links_is_active ON referral.links(is_active) WHERE is_active = TRUE;

-- ---------------------------------------------------------------------------
-- referral.clicks — záznamy prokliků (GDPR: ip/UA pouze hashe)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS referral.clicks (
  id                BIGSERIAL    PRIMARY KEY,
  link_id           UUID         NOT NULL REFERENCES referral.links(id) ON DELETE CASCADE,
  referrer_code     VARCHAR(16)  NOT NULL,
  visitor_id        VARCHAR(128) NOT NULL,
  session_id        VARCHAR(128) NOT NULL,
  ip_hash           VARCHAR(64)  NOT NULL,
  user_agent_hash   VARCHAR(64)  NOT NULL,
  occurred_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  converted         BOOLEAN      NOT NULL DEFAULT FALSE,
  converted_at      TIMESTAMPTZ  NULL
);

CREATE INDEX IF NOT EXISTS idx_referral_clicks_link_id     ON referral.clicks(link_id);
CREATE INDEX IF NOT EXISTS idx_referral_clicks_visitor_id  ON referral.clicks(visitor_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_referral_clicks_occurred_at ON referral.clicks(occurred_at);
CREATE INDEX IF NOT EXISTS idx_referral_clicks_ref_code    ON referral.clicks(referrer_code);

-- ---------------------------------------------------------------------------
-- referral.conversions — záznamy o úspěšných konverzích
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS referral.conversions (
  id                 UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  link_id            UUID         NOT NULL REFERENCES referral.links(id) ON DELETE RESTRICT,
  click_id           BIGINT       NULL REFERENCES referral.clicks(id) ON DELETE SET NULL,
  -- cross-schema ref na orders.orders — bez FK
  order_id           UUID         NOT NULL,
  -- cross-schema ref na identity.users — bez FK
  referred_user_id   UUID         NOT NULL,
  order_amount_czk   NUMERIC(14,2) NOT NULL CHECK (order_amount_czk >= 0),
  commission_rate    NUMERIC(5,4) NOT NULL CHECK (commission_rate >= 0 AND commission_rate <= 1),
  earned_czk         NUMERIC(14,2) NOT NULL CHECK (earned_czk >= 0),
  status             TEXT         NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'confirmed', 'paid', 'cancelled')),
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  confirmed_at       TIMESTAMPTZ  NULL,
  paid_at            TIMESTAMPTZ  NULL,
  UNIQUE (order_id)
);

CREATE INDEX IF NOT EXISTS idx_referral_conv_link_id      ON referral.conversions(link_id);
CREATE INDEX IF NOT EXISTS idx_referral_conv_order_id     ON referral.conversions(order_id);
CREATE INDEX IF NOT EXISTS idx_referral_conv_referred     ON referral.conversions(referred_user_id);
CREATE INDEX IF NOT EXISTS idx_referral_conv_status       ON referral.conversions(status);
CREATE INDEX IF NOT EXISTS idx_referral_conv_created_at   ON referral.conversions(created_at);
CREATE INDEX IF NOT EXISTS idx_referral_conv_confirmed_at ON referral.conversions(confirmed_at);

-- ---------------------------------------------------------------------------
-- referral.credit_wallet — cashback peněženka uživatele
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS referral.credit_wallet (
  -- cross-schema ref na identity.users — bez FK
  user_id              UUID          PRIMARY KEY,
  balance_czk          NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (balance_czk >= 0),
  lifetime_earned_czk  NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (lifetime_earned_czk >= 0),
  lifetime_spent_czk   NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (lifetime_spent_czk >= 0),
  updated_at           TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- referral.credit_transactions — účetní kniha peněženky
--
-- TODO (P1): Sjednotit amount_czk vs amount_halire. Aktuálně podporujeme oba
-- sloupce kvůli existujícím service implementacím (credit.service.ts používá
-- amount_czk, dual-reward.service.ts používá amount_halire + status).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS referral.credit_transactions (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID          NOT NULL,
  -- Kladná = earn, záporná = spend (negative amounts allowed)
  amount_czk      NUMERIC(14,2) NULL,
  amount_halire   INTEGER       NULL,
  type            TEXT          NOT NULL
    CHECK (type IN (
      'referral_earned',
      'order_discount',
      'expired',
      'manual_adjustment',
      'referral_reward_referrer',
      'referral_reward_new_customer'
    )),
  reference_id    TEXT          NULL,
  status          TEXT          NULL
    CHECK (status IS NULL OR status IN ('pending', 'available', 'used', 'expired', 'cancelled')),
  description     TEXT          NOT NULL DEFAULT '',
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  CHECK (amount_czk IS NOT NULL OR amount_halire IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_referral_ct_user_id      ON referral.credit_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_referral_ct_type         ON referral.credit_transactions(type);
CREATE INDEX IF NOT EXISTS idx_referral_ct_reference_id ON referral.credit_transactions(reference_id);
CREATE INDEX IF NOT EXISTS idx_referral_ct_created_at   ON referral.credit_transactions(created_at);
CREATE INDEX IF NOT EXISTS idx_referral_ct_status       ON referral.credit_transactions(status);

-- ---------------------------------------------------------------------------
-- referral.dual_rewards — audit / anti-fraud pro dual-side rewards (F#63)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS referral.dual_rewards (
  id                          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id                 UUID        NOT NULL,
  new_customer_id             UUID        NOT NULL,
  order_id                    UUID        NOT NULL UNIQUE,
  referrer_credit_id          UUID        NOT NULL REFERENCES referral.credit_transactions(id),
  new_customer_credit_id      UUID        NOT NULL REFERENCES referral.credit_transactions(id),
  referrer_reward_halire      INTEGER     NOT NULL CHECK (referrer_reward_halire >= 0),
  new_customer_reward_halire  INTEGER     NOT NULL CHECK (new_customer_reward_halire >= 0),
  device_fingerprint          VARCHAR(128) NULL,
  client_ip                   VARCHAR(64)  NULL,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (referrer_id <> new_customer_id)
);

CREATE INDEX IF NOT EXISTS idx_referral_dr_referrer    ON referral.dual_rewards(referrer_id);
CREATE INDEX IF NOT EXISTS idx_referral_dr_new_cust    ON referral.dual_rewards(new_customer_id);
CREATE INDEX IF NOT EXISTS idx_referral_dr_order       ON referral.dual_rewards(order_id);
CREATE INDEX IF NOT EXISTS idx_referral_dr_fingerprint ON referral.dual_rewards(device_fingerprint, created_at DESC)
  WHERE device_fingerprint IS NOT NULL;

COMMIT;
