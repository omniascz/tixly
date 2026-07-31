-- Migration 037: Rezervační vertikála — Katalog služeb (Service Catalog)
-- Module: @tixly/service-catalog
-- Schema: reservations (already exists from #166 slot engine)

-- ---------------------------------------------------------------------------
-- service_categories
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS reservations.service_categories (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  promoter_id  UUID NOT NULL,
  name         VARCHAR(100) NOT NULL,
  slug         VARCHAR(100) NOT NULL,
  description  TEXT,
  icon         VARCHAR(50),
  color        CHAR(7) NOT NULL DEFAULT '#6366f1',
  sort_order   INT NOT NULL DEFAULT 0,
  is_active    BOOL NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (promoter_id, slug)
);

-- ---------------------------------------------------------------------------
-- services
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS reservations.services (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  promoter_id          UUID NOT NULL,
  branch_id            UUID,
  category_id          UUID REFERENCES reservations.service_categories(id) ON DELETE SET NULL,
  name                 VARCHAR(200) NOT NULL,
  slug                 VARCHAR(200) NOT NULL,
  short_description    VARCHAR(500),
  description          TEXT,
  duration_minutes     INT NOT NULL CHECK (duration_minutes > 0),
  capacity_min         INT NOT NULL DEFAULT 1,
  capacity_max         INT NOT NULL DEFAULT 1,
  price_hellers        INT NOT NULL DEFAULT 0,
  price_type           VARCHAR(20) NOT NULL DEFAULT 'fixed'
                         CHECK (price_type IN ('fixed', 'per_person', 'per_hour', 'free')),
  requires_resource    BOOL NOT NULL DEFAULT true,
  resource_type        VARCHAR(50),
  cancellation_hours   INT NOT NULL DEFAULT 24,
  booking_window_days  INT NOT NULL DEFAULT 30,
  min_advance_hours    INT NOT NULL DEFAULT 1,
  images               TEXT[] NOT NULL DEFAULT '{}',
  tags                 TEXT[] NOT NULL DEFAULT '{}',
  metadata             JSONB NOT NULL DEFAULT '{}',
  is_active            BOOL NOT NULL DEFAULT true,
  is_featured          BOOL NOT NULL DEFAULT false,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (promoter_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_services_promoter_active
  ON reservations.services (promoter_id, is_active);

CREATE INDEX IF NOT EXISTS idx_services_category_id
  ON reservations.services (category_id);

CREATE INDEX IF NOT EXISTS idx_services_promoter_featured
  ON reservations.services (promoter_id, is_featured);

-- ---------------------------------------------------------------------------
-- service_resources — links services to specific slot engine resources
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS reservations.service_resources (
  service_id   UUID NOT NULL REFERENCES reservations.services(id) ON DELETE CASCADE,
  resource_id  UUID NOT NULL REFERENCES reservations.resources(id) ON DELETE CASCADE,
  is_primary   BOOL NOT NULL DEFAULT true,
  PRIMARY KEY (service_id, resource_id)
);

CREATE INDEX IF NOT EXISTS idx_service_resources_resource_id
  ON reservations.service_resources (resource_id);

-- ---------------------------------------------------------------------------
-- service_addons — optional add-ons bookable with a service
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS reservations.service_addons (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id    UUID NOT NULL REFERENCES reservations.services(id) ON DELETE CASCADE,
  name          VARCHAR(200) NOT NULL,
  description   TEXT,
  price_hellers INT NOT NULL DEFAULT 0,
  max_quantity  INT NOT NULL DEFAULT 1,
  is_required   BOOL NOT NULL DEFAULT false,
  is_active     BOOL NOT NULL DEFAULT true,
  sort_order    INT NOT NULL DEFAULT 0,
  UNIQUE (service_id, name)
);

-- ---------------------------------------------------------------------------
-- service_pricing_rules — dynamic pricing overrides
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS reservations.service_pricing_rules (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id           UUID NOT NULL REFERENCES reservations.services(id) ON DELETE CASCADE,
  name                 VARCHAR(100) NOT NULL,
  rule_type            VARCHAR(20) NOT NULL
                         CHECK (rule_type IN (
                           'peak_hours', 'off_peak', 'weekend', 'weekday',
                           'member', 'group', 'advance', 'last_minute'
                         )),
  price_modifier_type  VARCHAR(10) NOT NULL
                         CHECK (price_modifier_type IN ('fixed', 'percentage', 'absolute')),
  price_modifier_value INT NOT NULL,
  day_of_week          INT[],
  time_from            TIME,
  time_to              TIME,
  min_quantity         INT,
  advance_hours_min    INT,
  advance_hours_max    INT,
  is_active            BOOL NOT NULL DEFAULT true,
  priority             INT NOT NULL DEFAULT 0,
  UNIQUE (service_id, name)
);

CREATE INDEX IF NOT EXISTS idx_service_pricing_rules_service_active
  ON reservations.service_pricing_rules (service_id, is_active);

-- ---------------------------------------------------------------------------
-- service_reviews
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS reservations.service_reviews (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id  UUID NOT NULL REFERENCES reservations.services(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL,
  booking_id  UUID REFERENCES reservations.bookings(id) ON DELETE SET NULL,
  rating      INT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  title       VARCHAR(200),
  body        TEXT,
  is_verified BOOL NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (service_id, user_id, booking_id)
);

CREATE INDEX IF NOT EXISTS idx_service_reviews_service_id
  ON reservations.service_reviews (service_id);

CREATE INDEX IF NOT EXISTS idx_service_reviews_user_id
  ON reservations.service_reviews (user_id);
