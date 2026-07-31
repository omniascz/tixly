-- 325_modular_festival_passes.sql
-- Modular festival pass: kupec si v UI sám vybere (day × zone) checkbox matrix,
-- cena se dopočítá dynamicky podle promotér-nastavené tarifikace.
--
-- 2 nové tabulky:
--   1. catalog.ticket_modular_pricing
--      — promotér zapne `is_modular` na ticket_type, nastaví base_price_minor +
--        per_day_price_minor + per_zone_surcharge_minor. UI v buyer flow
--        spočítá price = base + days × per_day + zones × per_zone.
--   2. tickets.ticket_modular_access
--      — per-ticket selected (day_id × zone_id) tuples po koupi modular passu.
--        Scanner validuje proti TĚMTO rows pokud existují, jinak fallback na
--        catalog.ticket_type_access matrix (existing behavior).
--
-- Idempotent.

BEGIN;

-- ── 1) Promotér config per ticket_type ───────────────────────────────────────

CREATE TABLE IF NOT EXISTS catalog.ticket_modular_pricing (
  ticket_type_id          uuid PRIMARY KEY REFERENCES catalog.ticket_types(id) ON DELETE CASCADE,
  -- base_price_minor = catalog.ticket_types.base_price; tady jen incrementy
  per_day_price_minor     integer NOT NULL DEFAULT 0,
  per_zone_surcharge_minor integer NOT NULL DEFAULT 0,
  min_days                integer NOT NULL DEFAULT 1,
  max_days                integer,  -- NULL = no cap (= počet event_days)
  min_zones               integer NOT NULL DEFAULT 1,
  max_zones               integer,  -- NULL = no cap (= počet event_zones)
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT modular_pricing_per_day_check CHECK (per_day_price_minor >= 0),
  CONSTRAINT modular_pricing_per_zone_check CHECK (per_zone_surcharge_minor >= 0),
  CONSTRAINT modular_pricing_min_days_check CHECK (min_days >= 1),
  CONSTRAINT modular_pricing_min_zones_check CHECK (min_zones >= 1),
  CONSTRAINT modular_pricing_max_days_check CHECK (max_days IS NULL OR max_days >= min_days),
  CONSTRAINT modular_pricing_max_zones_check CHECK (max_zones IS NULL OR max_zones >= min_zones)
);

-- ── 2) Per-ticket modular selection (overrides ticket_type_access) ──────────

CREATE TABLE IF NOT EXISTS tickets.ticket_modular_access (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id           uuid NOT NULL REFERENCES tickets.tickets(id) ON DELETE CASCADE,
  event_day_id        uuid NOT NULL REFERENCES catalog.event_days(id) ON DELETE CASCADE,
  zone_id             uuid NOT NULL REFERENCES catalog.event_zones(id) ON DELETE CASCADE,
  access_level        text NOT NULL DEFAULT 'general',
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ticket_modular_access_level_check
    CHECK (access_level IN ('general', 'premium', 'vip', 'backstage', 'accessibility')),
  CONSTRAINT ticket_modular_access_unique UNIQUE (ticket_id, event_day_id, zone_id)
);

CREATE INDEX IF NOT EXISTS idx_ticket_modular_access_ticket
  ON tickets.ticket_modular_access(ticket_id);
CREATE INDEX IF NOT EXISTS idx_ticket_modular_access_day_zone
  ON tickets.ticket_modular_access(event_day_id, zone_id);

COMMENT ON TABLE catalog.ticket_modular_pricing IS
  'Modular festival pass — promotér nastaví incremental cenu, buyer si v UI '
  'vybere (day × zone) combo. Cena = ticket_types.base_price + days × per_day + '
  'zones × per_zone.';

COMMENT ON TABLE tickets.ticket_modular_access IS
  'Per-ticket selected (day × zone) po koupi modular passu. Scanner '
  'validate má fallthrough: pokud řádky existují, validuje proti TĚMTO '
  'rows; jinak proti catalog.ticket_type_access (default behavior).';

COMMIT;
