ALTER TABLE catalog.events ADD COLUMN IF NOT EXISTS social_distance_seats int NOT NULL DEFAULT 0
  CHECK (social_distance_seats >= 0 AND social_distance_seats <= 5);
