-- Migration 060: event-staff module — staff profiles, roles, and permissions

CREATE TABLE IF NOT EXISTS platform.staff_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  promoter_id UUID NOT NULL REFERENCES platform.promoters(id),
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  emergency_contact TEXT,
  employment_type TEXT NOT NULL,
  hourly_rate_halire INTEGER,
  status TEXT NOT NULL DEFAULT 'active',
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (promoter_id, email)
);

CREATE TABLE IF NOT EXISTS platform.staff_roles (
  staff_id UUID NOT NULL REFERENCES platform.staff_members(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  PRIMARY KEY (staff_id, role)
);

CREATE TABLE IF NOT EXISTS platform.staff_permissions (
  staff_id UUID NOT NULL REFERENCES platform.staff_members(id) ON DELETE CASCADE,
  permission TEXT NOT NULL,
  PRIMARY KEY (staff_id, permission)
);

CREATE INDEX IF NOT EXISTS idx_staff_members_promoter ON platform.staff_members(promoter_id);
CREATE INDEX IF NOT EXISTS idx_staff_members_status ON platform.staff_members(promoter_id, status);
