-- Migration 422: Fyzická prodejní síť — geolokace prodejních míst
-- Umožní veřejný locator "Najdi prodejní místo" pro kupující.
-- Rozšiřuje stávající reseller_partners o geo data + public listing.

ALTER TABLE platform.reseller_partners
  ADD COLUMN IF NOT EXISTS lat             numeric(9,6),
  ADD COLUMN IF NOT EXISTS lng             numeric(9,6),
  ADD COLUMN IF NOT EXISTS location_type  text NOT NULL DEFAULT 'partner',
  -- partner | kiosk | post_office | cinema | convenience
  ADD COLUMN IF NOT EXISTS opening_hours  text,         -- "Po–Pá 9–17, So 9–12"
  ADD COLUMN IF NOT EXISTS logo_url       text,
  ADD COLUMN IF NOT EXISTS public_listing boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS website        text,
  ADD COLUMN IF NOT EXISTS country        char(2) NOT NULL DEFAULT 'CZ';

-- Partial index pro rychlý veřejný locator
CREATE INDEX IF NOT EXISTS reseller_partners_public_city_idx
  ON platform.reseller_partners (city, country)
  WHERE public_listing = true AND status = 'active';

COMMENT ON COLUMN platform.reseller_partners.public_listing IS
  'Zobrazit toto prodejní místo na veřejném locatoru /sellers';
COMMENT ON COLUMN platform.reseller_partners.location_type IS
  'partner | kiosk | post_office | cinema | convenience';
