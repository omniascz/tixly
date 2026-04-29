-- Feature #46: database-level cap enforcement for resale listings
-- Ensures no application code can bypass the resale price cap.

-- 1) Hard CHECK: ask_price must be > 0
ALTER TABLE resale.resale_listings
  ADD CONSTRAINT listings_ask_price_positive
  CHECK (ask_price > 0);

-- 2) Hard CHECK: ask_price must be <= original_price (no profit on non-commercial resale)
-- This is the primary cap: "auto-cena = původní nákupní cena" means the UI sets
-- ask_price = original_price. This constraint guarantees no higher price is stored.
ALTER TABLE resale.resale_listings
  ADD CONSTRAINT listings_ask_price_le_original
  CHECK (ask_price <= original_price);

-- 3) Trigger: expires_at must be at least 24h before event start
CREATE OR REPLACE FUNCTION resale.enforce_listing_expiry_24h()
RETURNS TRIGGER AS $$
DECLARE
  v_event_start TIMESTAMPTZ;
BEGIN
  SELECT e.date_start INTO v_event_start
  FROM tickets.tickets t
  JOIN catalog.ticket_types tt ON tt.id = t.ticket_type_id
  JOIN catalog.events e ON e.id = tt.event_id
  WHERE t.id = NEW.ticket_id;

  IF v_event_start IS NULL THEN
    RAISE EXCEPTION 'ticket % not found or has no event', NEW.ticket_id;
  END IF;

  IF NEW.expires_at IS NULL OR NEW.expires_at > (v_event_start - INTERVAL '24 hours') THEN
    NEW.expires_at := v_event_start - INTERVAL '24 hours';
  END IF;

  IF NEW.expires_at <= NOW() THEN
    RAISE EXCEPTION 'event % too soon — resale expiry already passed', NEW.ticket_id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_listings_expiry_24h ON resale.resale_listings;
CREATE TRIGGER trg_listings_expiry_24h
  BEFORE INSERT OR UPDATE OF expires_at ON resale.resale_listings
  FOR EACH ROW
  EXECUTE FUNCTION resale.enforce_listing_expiry_24h();

COMMENT ON FUNCTION resale.enforce_listing_expiry_24h IS
  'Feature #46: clamps resale listing expiry to event_start - 24h and rejects listings created within the final 24h.';
