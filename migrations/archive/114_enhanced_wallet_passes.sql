-- Migration 114: Enhanced Apple Wallet — Dynamic content (Feature #51)
-- Dynamický obsah pasu: počasí, setlist, mapa, playlist.

CREATE TABLE IF NOT EXISTS passes.enhanced_content (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pass_id         UUID NOT NULL UNIQUE,                    -- ref: passes.wallet_passes(id)
  event_id        UUID NOT NULL,                           -- ref: catalog.events(id)
  weather         JSONB,                                   -- { temperatureC, condition, icon }
  venue_map       JSONB,                                   -- { lat, lng, label }
  setlist         JSONB NOT NULL DEFAULT '[]'::jsonb,     -- [ { artistName, startTime, duration } ]
  playlist        JSONB,                                   -- { spotifyPlaylistId, title, trackCount }
  last_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_pushed_at  TIMESTAMPTZ,                            -- kdy byl push do Apple Wallet
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_enhanced_event ON passes.enhanced_content (event_id);
