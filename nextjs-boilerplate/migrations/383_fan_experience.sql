-- Migration 383: Fan Experience & Upsell
-- Sponzorský modul per akci (Ticketmaster Ignite-style)
-- + Cestovní partnerské odkazy (30 % fanoušků cestuje na akce)

CREATE TABLE IF NOT EXISTS catalog.event_sponsors (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id      UUID NOT NULL REFERENCES catalog.events(id) ON DELETE CASCADE,
  name          TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  logo_url      TEXT,
  click_url     TEXT,
  tagline       TEXT CHECK (char_length(tagline) <= 200),
  placement     TEXT NOT NULL DEFAULT 'all'
                CHECK (placement IN ('confirmation', 'event_page', 'ticket_email', 'all')),
  active        BOOLEAN NOT NULL DEFAULT true,
  display_order INT NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS catalog.event_travel_links (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id       UUID NOT NULL REFERENCES catalog.events(id) ON DELETE CASCADE,
  label          TEXT NOT NULL CHECK (char_length(label) BETWEEN 1 AND 200),
  category       TEXT NOT NULL DEFAULT 'hotel'
                 CHECK (category IN ('hotel', 'transport', 'parking', 'rideshare', 'other')),
  partner_name   TEXT CHECK (char_length(partner_name) <= 100),
  url            TEXT NOT NULL,
  affiliate_note TEXT CHECK (char_length(affiliate_note) <= 200),
  active         BOOLEAN NOT NULL DEFAULT true,
  display_order  INT NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_event_sponsors_event_id      ON catalog.event_sponsors(event_id);
CREATE INDEX IF NOT EXISTS idx_event_travel_links_event_id  ON catalog.event_travel_links(event_id);

ALTER TABLE catalog.event_sponsors     ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalog.event_travel_links ENABLE ROW LEVEL SECURITY;

-- Promotér: vlastní akce
CREATE POLICY promoter_own_event_sponsors ON catalog.event_sponsors
  USING (event_id IN (
    SELECT id FROM catalog.events
    WHERE promoter_id = current_setting('app.promoter_id', TRUE)::UUID
  ));

CREATE POLICY promoter_own_event_travel_links ON catalog.event_travel_links
  USING (event_id IN (
    SELECT id FROM catalog.events
    WHERE promoter_id = current_setting('app.promoter_id', TRUE)::UUID
  ));

-- Platform admin: vše
CREATE POLICY platform_admin_event_sponsors ON catalog.event_sponsors
  USING (current_setting('app.is_platform_admin', TRUE) = 'true');

CREATE POLICY platform_admin_event_travel_links ON catalog.event_travel_links
  USING (current_setting('app.is_platform_admin', TRUE) = 'true');

-- Service role: bypass
CREATE POLICY service_role_event_sponsors ON catalog.event_sponsors
  USING (current_setting('app.use_service_role', TRUE) = 'true');

CREATE POLICY service_role_event_travel_links ON catalog.event_travel_links
  USING (current_setting('app.use_service_role', TRUE) = 'true');

GRANT SELECT, INSERT, UPDATE, DELETE ON catalog.event_sponsors     TO tixly_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON catalog.event_travel_links TO tixly_app;
