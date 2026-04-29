-- =============================================================================
-- 063_branch_hours_multi_range.sql
-- Allow multiple time ranges per day on a branch (e.g. 08:00-12:00 + 14:00-18:00).
-- Drops the old UNIQUE(branch_id, day_of_week) and adds range_index.
-- Also deprecates ems.opening_hours — branch_hours + branches.timezone is
-- now the single source of truth for all modules.
-- =============================================================================

-- 1. Drop old unique constraint that limited to 1 range per day
ALTER TABLE reservations.branch_hours
  DROP CONSTRAINT IF EXISTS uq_branch_hours_day;

-- 2. Add range_index to support multiple ranges per day
ALTER TABLE reservations.branch_hours
  ADD COLUMN IF NOT EXISTS range_index INT NOT NULL DEFAULT 0;

-- 3. New unique: (branch_id, day_of_week, range_index)
ALTER TABLE reservations.branch_hours
  ADD CONSTRAINT uq_branch_hours_day_range
    UNIQUE (branch_id, day_of_week, range_index);

-- 4. Mark ems.opening_hours as deprecated (keep for rollback safety, but
--    ems-booking no longer reads it — reads branch_hours instead)
COMMENT ON TABLE ems.opening_hours IS
  'DEPRECATED: Use reservations.branch_hours + reservations.branches.timezone instead. Kept for rollback.';
