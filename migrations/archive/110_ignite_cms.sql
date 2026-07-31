-- Migration 110: Ignite CMS — branded ticket content (Feature #48)
-- Editor digitální vstupenky: venue info, mapa, počasí, upsell, sponzor.

CREATE TABLE IF NOT EXISTS ignite.ticket_content (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id        UUID NOT NULL REFERENCES catalog.events(id) ON DELETE CASCADE,
  promoter_id     UUID NOT NULL,
  -- Content blocks stored as JSONB for flexibility
  venue_info      JSONB,          -- {address, directions, parking, accessibility}
  map_config      JSONB,          -- {lat, lng, zoom, markerLabel}
  upsell_blocks   JSONB,          -- [{title, description, imageUrl, ctaUrl, ctaLabel}]
  sponsor_blocks  JSONB,          -- [{name, logoUrl, url, displayOrder}]
  custom_message  TEXT,           -- Vlastní zpráva promotéra na vstupence (max 500 znaků)
  weather_enabled BOOLEAN NOT NULL DEFAULT false,  -- Zobraz počasí v den akce
  is_published    BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ticket_content_event_unique UNIQUE (event_id)
);

CREATE SCHEMA IF NOT EXISTS ignite;

-- Re-create table under correct schema
DROP TABLE IF EXISTS ignite.ticket_content;
CREATE TABLE ignite.ticket_content (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id        UUID NOT NULL,
  promoter_id     UUID NOT NULL,
  venue_info      JSONB,
  map_config      JSONB,
  upsell_blocks   JSONB NOT NULL DEFAULT '[]'::jsonb,
  sponsor_blocks  JSONB NOT NULL DEFAULT '[]'::jsonb,
  custom_message  TEXT CHECK (char_length(custom_message) <= 500),
  weather_enabled BOOLEAN NOT NULL DEFAULT false,
  is_published    BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ticket_content_event_unique UNIQUE (event_id)
);

-- Row-level security: promoter sees only their events' content
ALTER TABLE ignite.ticket_content ENABLE ROW LEVEL SECURITY;

CREATE POLICY ticket_content_promoter ON ignite.ticket_content
  USING (promoter_id = current_setting('app.current_promoter_id', true)::uuid);

-- Index for event lookup
CREATE INDEX idx_ticket_content_event ON ignite.ticket_content (event_id);
CREATE INDEX idx_ticket_content_promoter ON ignite.ticket_content (promoter_id);
