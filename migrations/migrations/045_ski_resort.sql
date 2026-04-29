-- =============================================================================
-- Migration 045: Ski Resort — skipas, vleky, single ride, RFID propojení
-- Schema: venues
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS venues;

-- ---------------------------------------------------------------------------
-- venues.ski_resorts
-- ---------------------------------------------------------------------------
CREATE TABLE venues.ski_resorts (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  promoter_id      UUID NOT NULL,
  name             VARCHAR(200) NOT NULL,
  altitude_base_m  INT,
  altitude_top_m   INT,
  total_pistes_km  DECIMAL(6,2),
  total_lifts      INT,
  snow_report      TEXT,
  webcam_url       TEXT,
  is_active        BOOL NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(promoter_id, name)
);

-- ---------------------------------------------------------------------------
-- venues.ski_pass_types
-- ---------------------------------------------------------------------------
CREATE TABLE venues.ski_pass_types (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  resort_id             UUID NOT NULL REFERENCES venues.ski_resorts(id),
  name                  VARCHAR(200) NOT NULL,
  pass_category         VARCHAR(20) NOT NULL CHECK (pass_category IN ('day','multi_day','season','single_ride','ski_school','equipment')),
  duration_days         INT,
  price_hellers         INT NOT NULL,
  child_price_hellers   INT,
  senior_price_hellers  INT,
  age_category          VARCHAR(20) NOT NULL DEFAULT 'adult' CHECK (age_category IN ('adult','child','senior','family')),
  valid_from            DATE,
  valid_until           DATE,
  includes_ski_school   BOOL NOT NULL DEFAULT false,
  includes_equipment    BOOL NOT NULL DEFAULT false,
  max_altitude_zone     INT NOT NULL DEFAULT 999,
  is_active             BOOL NOT NULL DEFAULT true,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(resort_id, name)
);

-- ---------------------------------------------------------------------------
-- venues.rfid_cards
-- ---------------------------------------------------------------------------
CREATE TABLE venues.rfid_cards (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  resort_id    UUID NOT NULL REFERENCES venues.ski_resorts(id),
  card_uid     VARCHAR(100) NOT NULL UNIQUE,
  user_id      UUID,
  status       VARCHAR(20) NOT NULL DEFAULT 'unissued' CHECK (status IN ('unissued','active','suspended','lost','expired')),
  issued_at    TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- venues.ski_pass_activations
-- ---------------------------------------------------------------------------
CREATE TABLE venues.ski_pass_activations (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pass_type_id     UUID NOT NULL REFERENCES venues.ski_pass_types(id),
  rfid_card_id     UUID REFERENCES venues.rfid_cards(id),
  user_id          UUID NOT NULL,
  order_id         UUID,
  valid_from       DATE NOT NULL,
  valid_until      DATE NOT NULL,
  rides_remaining  INT,
  status           VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active','expired','suspended','refunded')),
  activated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  age_category     VARCHAR(20) NOT NULL DEFAULT 'adult' CHECK (age_category IN ('adult','child','senior'))
);

-- ---------------------------------------------------------------------------
-- venues.lift_scans
-- ---------------------------------------------------------------------------
CREATE TABLE venues.lift_scans (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  activation_id UUID NOT NULL REFERENCES venues.ski_pass_activations(id),
  rfid_card_id  UUID REFERENCES venues.rfid_cards(id),
  lift_name     VARCHAR(100),
  scanned_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  scan_result   VARCHAR(30) NOT NULL CHECK (scan_result IN ('granted','denied_expired','denied_zone','denied_no_rides')),
  operator_id   UUID
);

-- ---------------------------------------------------------------------------
-- venues.ski_school_sessions
-- ---------------------------------------------------------------------------
CREATE TABLE venues.ski_school_sessions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  resort_id        UUID NOT NULL REFERENCES venues.ski_resorts(id),
  slot_id          UUID,
  instructor_name  VARCHAR(200),
  level            VARCHAR(20) NOT NULL CHECK (level IN ('beginner','intermediate','advanced','expert')),
  group_size_max   INT NOT NULL DEFAULT 8,
  session_date     DATE NOT NULL,
  start_time       TIME NOT NULL,
  duration_minutes INT NOT NULL DEFAULT 120,
  price_hellers    INT NOT NULL,
  is_private       BOOL NOT NULL DEFAULT false,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------
CREATE INDEX idx_rfid_cards_resort_status  ON venues.rfid_cards(resort_id, status);
CREATE INDEX idx_rfid_cards_uid            ON venues.rfid_cards(card_uid);
CREATE INDEX idx_spa_user_id               ON venues.ski_pass_activations(user_id);
CREATE INDEX idx_spa_rfid_card_id          ON venues.ski_pass_activations(rfid_card_id);
CREATE INDEX idx_spa_status_valid_until    ON venues.ski_pass_activations(status, valid_until);
CREATE INDEX idx_lift_scans_activation     ON venues.lift_scans(activation_id);
CREATE INDEX idx_lift_scans_scanned_at     ON venues.lift_scans(scanned_at);
