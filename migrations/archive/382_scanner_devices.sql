-- Migration 382: Scanner devices — hardware partner API keys
-- Průmyslové scannery (Zebra, NFC čtečky, turnikety) autentizují se device API klíčem.
-- Klíče jsou vázány na promotéra (a volitelně event + gate/zone).

CREATE TABLE IF NOT EXISTS catalog.scanner_devices (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  promoter_id UUID        NOT NULL REFERENCES platform.promoters(id) ON DELETE CASCADE,
  name        TEXT        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  description TEXT        CHECK (char_length(description) <= 500),
  api_key     TEXT        NOT NULL UNIQUE,
  event_id    UUID        REFERENCES catalog.events(id) ON DELETE SET NULL,
  gate_id     UUID        REFERENCES catalog.venue_gates(id) ON DELETE SET NULL,
  zone_id     UUID        REFERENCES catalog.event_zones(id) ON DELETE SET NULL,
  active      BOOLEAN     NOT NULL DEFAULT true,
  last_seen_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scanner_devices_promoter ON catalog.scanner_devices (promoter_id);
CREATE INDEX IF NOT EXISTS idx_scanner_devices_api_key  ON catalog.scanner_devices (api_key);

-- RLS
ALTER TABLE catalog.scanner_devices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "promoter_own_devices" ON catalog.scanner_devices
  FOR ALL
  USING (
    promoter_id = (
      SELECT p.id FROM platform.promoters p
      WHERE p.id = promoter_id
        AND EXISTS (
          SELECT 1 FROM platform.promoter_members pm
          WHERE pm.promoter_id = p.id
            AND pm.user_id = current_setting('app.current_user_id', true)::uuid
        )
    )
  );

CREATE POLICY "platform_admin_devices" ON catalog.scanner_devices
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM identity.users u
      WHERE u.id = current_setting('app.current_user_id', true)::uuid
        AND u.is_platform_admin = true
    )
  );

CREATE POLICY "service_role_devices" ON catalog.scanner_devices
  FOR ALL
  USING (current_setting('app.bypass_rls', true) = 'true');

GRANT SELECT, INSERT, UPDATE, DELETE ON catalog.scanner_devices TO tixly_app;
