-- Migration 039: Branch Management
-- Schema: reservations
-- Module: #169 Rezervační vertikála — Branch management (správa poboček)

-- ---------------------------------------------------------------------------
-- branches
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS reservations.branches (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  promoter_id      UUID NOT NULL,
  name             VARCHAR(200) NOT NULL,
  slug             VARCHAR(200) NOT NULL,
  description      TEXT,
  address_street   VARCHAR(300),
  address_city     VARCHAR(100),
  address_zip      VARCHAR(20),
  address_country  CHAR(2) DEFAULT 'CZ',
  latitude         DECIMAL(10,7),
  longitude        DECIMAL(10,7),
  phone            VARCHAR(50),
  email            VARCHAR(200),
  timezone         VARCHAR(50) DEFAULT 'Europe/Prague',
  is_active        BOOL DEFAULT true,
  is_main          BOOL DEFAULT false,
  metadata         JSONB DEFAULT '{}',
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_branch_promoter_slug UNIQUE (promoter_id, slug)
);

COMMENT ON COLUMN reservations.branches.is_main IS 'Only one main branch per promoter allowed; enforced at application layer.';

-- ---------------------------------------------------------------------------
-- branch_hours — regular opening hours
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS reservations.branch_hours (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id    UUID NOT NULL REFERENCES reservations.branches(id) ON DELETE CASCADE,
  day_of_week  INT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  open_time    TIME NOT NULL,
  close_time   TIME NOT NULL,
  is_closed    BOOL DEFAULT false,
  CONSTRAINT uq_branch_hours_day UNIQUE (branch_id, day_of_week),
  CONSTRAINT chk_close_after_open CHECK (is_closed OR close_time > open_time)
);

-- ---------------------------------------------------------------------------
-- branch_closures — one-off closures (holidays, maintenance)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS reservations.branch_closures (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id           UUID NOT NULL REFERENCES reservations.branches(id) ON DELETE CASCADE,
  closure_date        DATE NOT NULL,
  reason              VARCHAR(200),
  is_partial          BOOL DEFAULT false,
  partial_open_from   TIME,
  partial_open_until  TIME,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_branch_closure_date UNIQUE (branch_id, closure_date)
);

-- ---------------------------------------------------------------------------
-- branch_settings — key-value config per branch
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS reservations.branch_settings (
  branch_id      UUID NOT NULL REFERENCES reservations.branches(id) ON DELETE CASCADE,
  setting_key    VARCHAR(100) NOT NULL,
  setting_value  TEXT,
  setting_type   VARCHAR(20) NOT NULL DEFAULT 'string'
                   CHECK (setting_type IN ('string', 'integer', 'boolean', 'json')),
  updated_at     TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (branch_id, setting_key)
);

-- ---------------------------------------------------------------------------
-- branch_staff — which staff members work at which branch
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS reservations.branch_staff (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id   UUID NOT NULL REFERENCES reservations.branches(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL,
  role        VARCHAR(20) NOT NULL
                CHECK (role IN ('manager', 'staff', 'receptionist', 'instructor', 'viewer')),
  is_active   BOOL DEFAULT true,
  hired_at    DATE,
  notes       TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_branch_staff_user UNIQUE (branch_id, user_id)
);

-- ---------------------------------------------------------------------------
-- branch_service_availability — which services are available at which branch
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS reservations.branch_service_availability (
  branch_id              UUID NOT NULL REFERENCES reservations.branches(id) ON DELETE CASCADE,
  service_id             UUID NOT NULL REFERENCES reservations.services(id) ON DELETE CASCADE,
  is_available           BOOL DEFAULT true,
  price_override_hellers INT,
  notes                  TEXT,
  PRIMARY KEY (branch_id, service_id)
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_branches_promoter_active
  ON reservations.branches (promoter_id, is_active);

CREATE INDEX IF NOT EXISTS idx_branch_hours_branch
  ON reservations.branch_hours (branch_id);

CREATE INDEX IF NOT EXISTS idx_branch_closures_branch_date
  ON reservations.branch_closures (branch_id, closure_date);

CREATE INDEX IF NOT EXISTS idx_branch_staff_branch
  ON reservations.branch_staff (branch_id);

CREATE INDEX IF NOT EXISTS idx_branch_staff_user
  ON reservations.branch_staff (user_id);

CREATE INDEX IF NOT EXISTS idx_branch_service_avail_service
  ON reservations.branch_service_availability (service_id);
