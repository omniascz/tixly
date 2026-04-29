-- Migration 101: Staff availability, shift swaps, open shifts
-- Extends platform schema with scheduling enhancements

CREATE TABLE IF NOT EXISTS platform.staff_availability (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id      UUID NOT NULL REFERENCES platform.staff_members(id) ON DELETE CASCADE,
  promoter_id   UUID NOT NULL,
  starts_at     TIMESTAMPTZ NOT NULL,
  ends_at       TIMESTAMPTZ NOT NULL,
  reason        VARCHAR(20) NOT NULL CHECK (reason IN ('vacation','sick','personal','other')),
  notes         TEXT,
  approved      BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT staff_availability_range CHECK (ends_at > starts_at)
);

CREATE INDEX ON platform.staff_availability (staff_id, starts_at, ends_at);
CREATE INDEX ON platform.staff_availability (promoter_id, approved);

CREATE TABLE IF NOT EXISTS platform.staff_shift_swaps (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id            UUID NOT NULL REFERENCES platform.staff_shifts(id) ON DELETE CASCADE,
  requester_staff_id  UUID NOT NULL REFERENCES platform.staff_members(id),
  target_staff_id     UUID REFERENCES platform.staff_members(id),
  accepter_staff_id   UUID REFERENCES platform.staff_members(id),
  status              VARCHAR(20) NOT NULL DEFAULT 'open'
                      CHECK (status IN ('open','pending_approval','approved','rejected','cancelled')),
  reason              TEXT,
  promoter_id         UUID NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  responded_at        TIMESTAMPTZ,
  approved_at         TIMESTAMPTZ
);

CREATE INDEX ON platform.staff_shift_swaps (promoter_id, status);
CREATE INDEX ON platform.staff_shift_swaps (shift_id);
CREATE UNIQUE INDEX ON platform.staff_shift_swaps (shift_id)
  WHERE status IN ('open', 'pending_approval');

CREATE TABLE IF NOT EXISTS platform.staff_open_shifts (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  promoter_id         UUID NOT NULL,
  event_id            UUID NOT NULL,
  required_role       VARCHAR(30) NOT NULL,
  zone                VARCHAR(200),
  starts_at           TIMESTAMPTZ NOT NULL,
  ends_at             TIMESTAMPTZ NOT NULL,
  hourly_rate_halire  INTEGER,
  slots_total         INTEGER NOT NULL DEFAULT 1 CHECK (slots_total > 0),
  slots_claimed       INTEGER NOT NULL DEFAULT 0 CHECK (slots_claimed >= 0),
  is_active           BOOLEAN NOT NULL DEFAULT TRUE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT open_shift_range CHECK (ends_at > starts_at),
  CONSTRAINT open_shift_slot_limit CHECK (slots_claimed <= slots_total)
);

CREATE INDEX ON platform.staff_open_shifts (promoter_id, is_active, starts_at);
CREATE INDEX ON platform.staff_open_shifts (event_id);
