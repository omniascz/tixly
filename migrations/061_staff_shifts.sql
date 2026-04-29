-- Migration 061: event-staff module — shift scheduling

CREATE TABLE IF NOT EXISTS platform.staff_shifts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  promoter_id UUID NOT NULL,
  event_id UUID NOT NULL,
  staff_id UUID NOT NULL REFERENCES platform.staff_members(id),
  role TEXT NOT NULL,
  zone TEXT,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled',
  notes TEXT,
  actual_starts_at TIMESTAMPTZ,
  actual_ends_at TIMESTAMPTZ,
  payout_halire INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CHECK (ends_at > starts_at)
);

CREATE INDEX IF NOT EXISTS idx_shifts_event ON platform.staff_shifts(event_id);
CREATE INDEX IF NOT EXISTS idx_shifts_staff_time ON platform.staff_shifts(staff_id, starts_at, ends_at);
CREATE INDEX IF NOT EXISTS idx_shifts_promoter_event ON platform.staff_shifts(promoter_id, event_id);
