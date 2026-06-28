-- RFID Presence infrastruktura (TM Presence style)
-- Rozšiřuje existující tickets.wristbands (cashless) o zónový přístupový systém.

-- ── Zóny per akce ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS catalog.rfid_zones (
  id                      uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  event_id                uuid NOT NULL REFERENCES catalog.events(id) ON DELETE CASCADE,
  name                    text NOT NULL,              -- "General Admission", "VIP", "Backstage"
  code                    text NOT NULL,              -- krátký kód: GA, VIP, BACK
  capacity                int,                        -- NULL = neomezeno
  anti_passback           boolean NOT NULL DEFAULT true,
  allowed_ticket_type_ids uuid[],                     -- NULL = všechny ticket types
  sort_order              int NOT NULL DEFAULT 0,
  created_at              timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE (event_id, code)
);
CREATE INDEX IF NOT EXISTS idx_rfid_zones_event ON catalog.rfid_zones(event_id);

-- ── RFID čtecí zařízení (odděleno od scanner_devices pro QR) ─────────────────
CREATE TABLE IF NOT EXISTS catalog.rfid_devices (
  id           uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  event_id     uuid NOT NULL REFERENCES catalog.events(id) ON DELETE CASCADE,
  zone_id      uuid REFERENCES catalog.rfid_zones(id) ON DELETE SET NULL,
  name         text NOT NULL,
  direction    text NOT NULL DEFAULT 'in'  CHECK (direction IN ('in', 'out', 'both')),
  api_key      text NOT NULL UNIQUE,       -- tixly_rfid_<hex>
  active       boolean NOT NULL DEFAULT true,
  last_seen_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_rfid_devices_event  ON catalog.rfid_devices(event_id);
CREATE INDEX IF NOT EXISTS idx_rfid_devices_apikey ON catalog.rfid_devices(api_key);

-- ── Přítomnost (anti-passback stav) ─────────────────────────────────────────
-- Jeden řádek = náramek je momentálně uvnitř zóny.
-- INSERT při vstupu, DELETE při výstupu.
CREATE TABLE IF NOT EXISTS catalog.rfid_presence (
  wristband_uid text NOT NULL,
  event_id      uuid NOT NULL,
  zone_id       uuid NOT NULL REFERENCES catalog.rfid_zones(id) ON DELETE CASCADE,
  entered_at    timestamptz NOT NULL DEFAULT NOW(),
  PRIMARY KEY (wristband_uid, event_id, zone_id)
);
CREATE INDEX IF NOT EXISTS idx_rfid_presence_zone ON catalog.rfid_presence(zone_id);

-- ── Přístupový log (audit trail) ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS catalog.rfid_access_log (
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  event_id      uuid NOT NULL,
  wristband_uid text NOT NULL,
  zone_id       uuid REFERENCES catalog.rfid_zones(id) ON DELETE SET NULL,
  device_id     uuid REFERENCES catalog.rfid_devices(id) ON DELETE SET NULL,
  direction     text NOT NULL CHECK (direction IN ('in', 'out')),
  result        text NOT NULL CHECK (result IN (
                  'admitted', 'denied_not_authorized', 'denied_anti_passback',
                  'denied_zone_full', 'denied_no_wristband', 'denied_inactive'
                )),
  scanned_at    timestamptz NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_rfid_log_event    ON catalog.rfid_access_log(event_id, scanned_at DESC);
CREATE INDEX IF NOT EXISTS idx_rfid_log_uid      ON catalog.rfid_access_log(wristband_uid, scanned_at DESC);
CREATE INDEX IF NOT EXISTS idx_rfid_log_zone     ON catalog.rfid_access_log(zone_id, scanned_at DESC);

-- RLS (service context bypass)
ALTER TABLE catalog.rfid_zones       ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalog.rfid_devices     ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalog.rfid_presence    ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalog.rfid_access_log  ENABLE ROW LEVEL SECURITY;

CREATE POLICY rfid_zones_svc       ON catalog.rfid_zones      USING (current_setting('app.bypass_rls', true) = 'on');
CREATE POLICY rfid_devices_svc     ON catalog.rfid_devices    USING (current_setting('app.bypass_rls', true) = 'on');
CREATE POLICY rfid_presence_svc    ON catalog.rfid_presence   USING (current_setting('app.bypass_rls', true) = 'on');
CREATE POLICY rfid_access_log_svc  ON catalog.rfid_access_log USING (current_setting('app.bypass_rls', true) = 'on');
