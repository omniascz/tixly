-- =============================================================================
-- Migration 139: Tour / Series Management
-- Feature #27: Group related events (tour legs, multi-day festival, series)
-- Enables cross-event reporting, shared seat maps, and bulk operations.
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS tours;

-- Tour / series (group of related events)
CREATE TABLE tours.series (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  promoter_id           UUID NOT NULL,
  name                  TEXT NOT NULL,
  series_type           TEXT NOT NULL CHECK (series_type IN ('tour', 'festival', 'series', 'conference')),
  description           TEXT,
  artwork_url           TEXT,
  start_date            DATE,
  end_date              DATE,
  is_active             BOOL NOT NULL DEFAULT true,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Events belonging to a series / tour leg
CREATE TABLE tours.series_events (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  series_id             UUID NOT NULL REFERENCES tours.series(id),
  event_id              UUID NOT NULL REFERENCES catalog.events(id),
  leg_number            INT,             -- Tour leg order (1, 2, 3...)
  is_headline           BOOL NOT NULL DEFAULT false,  -- Main event in the series
  custom_name           TEXT,            -- Override event name for tour context
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(series_id, event_id)
);

-- Shared seat map configuration (optional — for multi-day same venue)
CREATE TABLE tours.shared_seat_maps (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  series_id             UUID NOT NULL REFERENCES tours.series(id),
  seat_map_id           UUID,            -- References seat_maps.maps if applicable
  apply_to_all_events   BOOL NOT NULL DEFAULT false,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Series-level analytics rollup
CREATE TABLE tours.series_metrics (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  series_id             UUID NOT NULL REFERENCES tours.series(id) UNIQUE,
  total_events          INT NOT NULL DEFAULT 0,
  total_capacity        INT NOT NULL DEFAULT 0,
  total_sold            INT NOT NULL DEFAULT 0,
  total_revenue_hellers BIGINT NOT NULL DEFAULT 0,
  avg_occupancy_pct     DECIMAL(5,2) DEFAULT 0,
  last_calculated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_series_promoter ON tours.series(promoter_id);
CREATE INDEX idx_series_events_series ON tours.series_events(series_id);
CREATE INDEX idx_series_events_event ON tours.series_events(event_id);
CREATE INDEX idx_series_metrics_series ON tours.series_metrics(series_id);
