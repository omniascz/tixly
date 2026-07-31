-- Migration 116: Spotify Artist links (Feature #56)
-- "Get Tickets" na Spotify stránce umělce.

CREATE SCHEMA IF NOT EXISTS music;

CREATE TABLE music.spotify_artist_links (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id            UUID NOT NULL,              -- ref: catalog.events(id)
  artist_spotify_id   TEXT NOT NULL,              -- Spotify artist ID
  artist_name         TEXT NOT NULL,
  ticket_url          TEXT NOT NULL,              -- Link na prodej vstupenek
  status              TEXT NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active', 'paused', 'expired')),
  linked_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at          TIMESTAMPTZ,                -- Automatické vypršení po datu akce
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (event_id, artist_spotify_id)
);

CREATE INDEX idx_spotify_event    ON music.spotify_artist_links (event_id);
CREATE INDEX idx_spotify_artist   ON music.spotify_artist_links (artist_spotify_id);
CREATE INDEX idx_spotify_active   ON music.spotify_artist_links (event_id) WHERE status = 'active';
