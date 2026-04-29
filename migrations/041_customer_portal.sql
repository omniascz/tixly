-- =============================================================================
-- Migration 041: Customer Portal v2
-- Schema: reservations
-- =============================================================================

-- ---------------------------------------------------------------------------
-- customer_profiles
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reservations.customer_profiles (
  id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID         NOT NULL,
  promoter_id         UUID         NOT NULL,
  display_name        VARCHAR(200),
  phone               VARCHAR(50),
  birth_date          DATE,
  preferred_language  CHAR(2)      NOT NULL DEFAULT 'cs',
  notification_email  BOOLEAN      NOT NULL DEFAULT true,
  notification_sms    BOOLEAN      NOT NULL DEFAULT false,
  notification_push   BOOLEAN      NOT NULL DEFAULT true,
  marketing_consent   BOOLEAN      NOT NULL DEFAULT false,
  terms_accepted_at   TIMESTAMPTZ,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, promoter_id)
);

CREATE INDEX IF NOT EXISTS idx_customer_profiles_promoter_user
  ON reservations.customer_profiles (promoter_id, user_id);

-- ---------------------------------------------------------------------------
-- customer_favorites
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reservations.customer_favorites (
  user_id       UUID        NOT NULL,
  promoter_id   UUID        NOT NULL,
  entity_type   TEXT        NOT NULL CHECK (entity_type IN ('service', 'branch', 'resource')),
  entity_id     UUID        NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, promoter_id, entity_type, entity_id)
);

CREATE INDEX IF NOT EXISTS idx_customer_favorites_user_promoter
  ON reservations.customer_favorites (user_id, promoter_id);

-- ---------------------------------------------------------------------------
-- booking_receipts
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reservations.booking_receipts (
  id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id        UUID         NOT NULL UNIQUE,
  user_id           UUID         NOT NULL,
  promoter_id       UUID         NOT NULL,
  receipt_number    VARCHAR(50)  NOT NULL UNIQUE,
  line_items        JSONB        NOT NULL,
  subtotal_hellers  INTEGER      NOT NULL,
  discount_hellers  INTEGER      NOT NULL DEFAULT 0,
  surcharge_hellers INTEGER      NOT NULL DEFAULT 0,
  total_hellers     INTEGER      NOT NULL,
  currency          CHAR(3)      NOT NULL DEFAULT 'CZK',
  issued_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  pdf_url           TEXT
);

CREATE INDEX IF NOT EXISTS idx_booking_receipts_user_id
  ON reservations.booking_receipts (user_id);

CREATE INDEX IF NOT EXISTS idx_booking_receipts_receipt_number
  ON reservations.booking_receipts (receipt_number);

-- ---------------------------------------------------------------------------
-- waitlist_entries
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reservations.waitlist_entries (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  slot_id      UUID        NOT NULL REFERENCES reservations.slots (id) ON DELETE CASCADE,
  user_id      UUID        NOT NULL,
  promoter_id  UUID        NOT NULL,
  quantity     INTEGER     NOT NULL DEFAULT 1,
  status       TEXT        NOT NULL DEFAULT 'waiting'
                            CHECK (status IN ('waiting', 'notified', 'booked', 'expired', 'cancelled')),
  notified_at  TIMESTAMPTZ,
  expires_at   TIMESTAMPTZ DEFAULT NOW() + INTERVAL '2 hours',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (slot_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_waitlist_entries_slot_status
  ON reservations.waitlist_entries (slot_id, status);

CREATE INDEX IF NOT EXISTS idx_waitlist_entries_user_id
  ON reservations.waitlist_entries (user_id);

-- ---------------------------------------------------------------------------
-- customer_notes (internal, visible to staff only)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reservations.customer_notes (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID        NOT NULL,
  promoter_id     UUID        NOT NULL,
  author_user_id  UUID        NOT NULL,
  note            TEXT        NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_customer_notes_user_promoter
  ON reservations.customer_notes (user_id, promoter_id);
