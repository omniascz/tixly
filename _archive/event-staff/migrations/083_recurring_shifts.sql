-- =============================================================================
-- 083_recurring_shifts.sql
-- Weekly recurring shift templates that materialize into staff_shifts rows.
-- =============================================================================

CREATE TABLE platform.recurring_shift_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  promoter_id UUID NOT NULL,
  branch_id UUID NOT NULL,
  staff_id UUID NOT NULL REFERENCES platform.staff_members(id),
  role TEXT NOT NULL,
  zone TEXT,
  day_of_week TEXT NOT NULL CHECK (day_of_week IN ('mon','tue','wed','thu','fri','sat','sun')),
  start_time_local TEXT NOT NULL,
  end_time_local TEXT NOT NULL,
  effective_from DATE NOT NULL,
  effective_until DATE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_recurring_templates_promoter ON platform.recurring_shift_templates(promoter_id, is_active);
CREATE INDEX idx_recurring_templates_staff ON platform.recurring_shift_templates(staff_id);
