-- Migration 127: Sustainability reporting (Feature #67)

CREATE SCHEMA IF NOT EXISTS sustainability;

CREATE TABLE sustainability.event_metrics (
  id                               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id                         UUID NOT NULL UNIQUE,        -- ref: catalog.events(id)
  attendee_count                   INTEGER NOT NULL,
  venue_energy_kwh                 NUMERIC(10, 2) NOT NULL,
  co2_transport_tonnes             NUMERIC(10, 4) NOT NULL,     -- doprava
  co2_venue_energy_tonnes          NUMERIC(10, 4) NOT NULL,     -- energie
  co2_total_tonnes                 NUMERIC(10, 4) NOT NULL,
  carbon_offset_recommendations    TEXT[] NOT NULL DEFAULT '{}',
  waste_reduction_tips             TEXT[] NOT NULL DEFAULT '{}',
  digital_signage_enabled          BOOLEAN NOT NULL DEFAULT false,
  tree_equivalent                  INTEGER NOT NULL,            -- kolik stromů na offset
  calculated_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sustainability_event ON sustainability.event_metrics (event_id);
