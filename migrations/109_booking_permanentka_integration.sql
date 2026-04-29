-- ---------------------------------------------------------------------------
-- Migration 109: permanentka_usage_id on reservations.bookings
-- Links an EMS/fitness booking to the permanentka credit usage record so that
-- cancellation can trigger an automatic credit refund.
-- ---------------------------------------------------------------------------

ALTER TABLE reservations.bookings
  ADD COLUMN permanentka_usage_id UUID;

COMMENT ON COLUMN reservations.bookings.permanentka_usage_id IS
  'References permanentky.usages(id) when this booking was paid via a permanentka credit package. NULL for cash/card bookings.';

CREATE INDEX bookings_permanentka_usage_idx
  ON reservations.bookings (permanentka_usage_id)
  WHERE permanentka_usage_id IS NOT NULL;
