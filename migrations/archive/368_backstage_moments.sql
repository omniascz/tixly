BEGIN;

-- Zákulisní video posílané divákům před začátkem představení
CREATE TABLE IF NOT EXISTS catalog.backstage_moments (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id              UUID NOT NULL REFERENCES catalog.events(id) ON DELETE CASCADE UNIQUE,
  video_url             TEXT NOT NULL,
  thumbnail_url         TEXT,
  title                 TEXT NOT NULL DEFAULT 'Zákulisí dnešního večera',
  description           TEXT,
  notify_minutes_before INT NOT NULL DEFAULT 10,
  is_active             BOOLEAN NOT NULL DEFAULT true,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMIT;
