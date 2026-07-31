-- ---------------------------------------------------------------------------
-- Migration 036: Slot Engine — Reservation Vertical
-- ---------------------------------------------------------------------------

CREATE SCHEMA IF NOT EXISTS reservations;

-- ---------------------------------------------------------------------------
-- resources — the bookable entity (court, room, instructor, equipment, lane)
-- ---------------------------------------------------------------------------

CREATE TABLE reservations.resources (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  promoter_id   UUID NOT NULL,
  branch_id     UUID,
  name          VARCHAR(200) NOT NULL,
  resource_type VARCHAR(50) NOT NULL,
  description   TEXT,
  capacity      INT NOT NULL DEFAULT 1,
  is_active     BOOL DEFAULT true,
  metadata      JSONB DEFAULT '{}',
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Unique name per promoter + branch (when branch_id IS NOT NULL)
CREATE UNIQUE INDEX resources_promoter_branch_name_uq
  ON reservations.resources (promoter_id, branch_id, name)
  WHERE branch_id IS NOT NULL;

-- Unique name per promoter (when branch_id IS NULL)
CREATE UNIQUE INDEX resources_promoter_name_uq
  ON reservations.resources (promoter_id, name)
  WHERE branch_id IS NULL;

-- ---------------------------------------------------------------------------
-- availability_rules — recurring availability patterns
-- ---------------------------------------------------------------------------

CREATE TABLE reservations.availability_rules (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_id            UUID NOT NULL REFERENCES reservations.resources(id) ON DELETE CASCADE,
  day_of_week            INT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time             TIME NOT NULL,
  end_time               TIME NOT NULL,
  slot_duration_minutes  INT NOT NULL DEFAULT 60,
  max_advance_days       INT DEFAULT 30,
  price_hellers          INT NOT NULL DEFAULT 0,
  is_active              BOOL DEFAULT true,
  valid_from             DATE,
  valid_until            DATE,
  CONSTRAINT ar_end_after_start CHECK (end_time > start_time),
  UNIQUE (resource_id, day_of_week, start_time)
);

CREATE INDEX availability_rules_resource_dow_idx
  ON reservations.availability_rules (resource_id, day_of_week);

-- ---------------------------------------------------------------------------
-- availability_overrides — exceptions to rules
-- ---------------------------------------------------------------------------

CREATE TABLE reservations.availability_overrides (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_id       UUID NOT NULL REFERENCES reservations.resources(id) ON DELETE CASCADE,
  override_date     DATE NOT NULL,
  override_type     VARCHAR(20) NOT NULL CHECK (override_type IN ('closed', 'open', 'price_override', 'capacity_override')),
  start_time        TIME,
  end_time          TIME,
  price_hellers     INT,
  capacity_override INT,
  reason            TEXT,
  UNIQUE (resource_id, override_date, start_time)
);

-- ---------------------------------------------------------------------------
-- slots — materialized time slots
-- ---------------------------------------------------------------------------

CREATE TABLE reservations.slots (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_id             UUID NOT NULL REFERENCES reservations.resources(id) ON DELETE CASCADE,
  slot_date               DATE NOT NULL,
  start_time              TIME NOT NULL,
  end_time                TIME NOT NULL,
  capacity                INT NOT NULL,
  booked_count            INT NOT NULL DEFAULT 0,
  price_hellers           INT NOT NULL,
  status                  VARCHAR(20) NOT NULL DEFAULT 'available'
                            CHECK (status IN ('available', 'partial', 'full', 'closed', 'cancelled')),
  generated_from_rule_id  UUID REFERENCES reservations.availability_rules(id) ON DELETE SET NULL,
  override_id             UUID REFERENCES reservations.availability_overrides(id) ON DELETE SET NULL,
  CONSTRAINT slots_booked_le_capacity CHECK (booked_count <= capacity),
  UNIQUE (resource_id, slot_date, start_time)
);

CREATE INDEX slots_resource_date_idx
  ON reservations.slots (resource_id, slot_date);

CREATE INDEX slots_status_date_idx
  ON reservations.slots (status, slot_date);

-- ---------------------------------------------------------------------------
-- bookings — individual reservations
-- ---------------------------------------------------------------------------

CREATE TABLE reservations.bookings (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slot_id               UUID NOT NULL REFERENCES reservations.slots(id) ON DELETE RESTRICT,
  user_id               UUID NOT NULL,
  promoter_id           UUID NOT NULL,
  quantity              INT NOT NULL DEFAULT 1,
  status                VARCHAR(20) NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending', 'confirmed', 'cancelled', 'no_show', 'completed')),
  price_hellers         INT NOT NULL,
  order_id              UUID,
  notes                 TEXT,
  booked_at             TIMESTAMPTZ DEFAULT NOW(),
  cancelled_at          TIMESTAMPTZ,
  cancellation_reason   TEXT,
  reminder_sent_at      TIMESTAMPTZ,
  CONSTRAINT bookings_quantity_ge_1 CHECK (quantity >= 1)
);

CREATE INDEX bookings_slot_id_idx
  ON reservations.bookings (slot_id);

CREATE INDEX bookings_user_id_idx
  ON reservations.bookings (user_id);

CREATE INDEX bookings_promoter_status_idx
  ON reservations.bookings (promoter_id, status);

-- ---------------------------------------------------------------------------
-- booking_holds — short-lived locks (10-minute holds)
-- ---------------------------------------------------------------------------

CREATE TABLE reservations.booking_holds (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slot_id        UUID NOT NULL REFERENCES reservations.slots(id) ON DELETE CASCADE,
  user_id        UUID NOT NULL,
  quantity       INT NOT NULL DEFAULT 1,
  held_until     TIMESTAMPTZ NOT NULL,
  session_token  UUID NOT NULL DEFAULT gen_random_uuid(),
  UNIQUE (slot_id, user_id)
);

CREATE INDEX booking_holds_slot_id_idx
  ON reservations.booking_holds (slot_id);

CREATE INDEX booking_holds_held_until_idx
  ON reservations.booking_holds (held_until);
