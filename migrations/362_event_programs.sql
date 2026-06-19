-- 362_event_programs.sql
-- Digitální program (placený add-on — divadlo na něm vydělává stejně jako na tištěném)
-- catalog.event_programs: jeden program per event s texty, ceníkem a galerií
-- catalog.program_cast_entries: obsazení v rámci programu (může se lišit od performance_cast)
-- orders.program_purchases: zakoupení programu navázané na objednávku, s přístupovým tokenem

BEGIN;

CREATE TABLE IF NOT EXISTS catalog.event_programs (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id                UUID NOT NULL REFERENCES catalog.events(id) ON DELETE CASCADE UNIQUE,
  title                   TEXT,
  about_text              TEXT,        -- O hře
  director_note           TEXT,        -- Režisérova poznámka
  dramaturg_note          TEXT,        -- Dramaturgická poznámka
  running_time_minutes    INT,
  intermissions           INT NOT NULL DEFAULT 0,
  language                TEXT NOT NULL DEFAULT 'cs',
  content_warnings        TEXT[],
  program_price_halire    INT NOT NULL DEFAULT 0,   -- 0 = zdarma, >0 = platí kupující
  cover_image_url         TEXT,
  gallery_urls            TEXT[],
  is_published            BOOLEAN NOT NULL DEFAULT false,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS catalog.program_cast_entries (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id  UUID NOT NULL REFERENCES catalog.event_programs(id) ON DELETE CASCADE,
  artist_name TEXT NOT NULL,
  artist_id   UUID REFERENCES lineups.artists(id),
  role_name   TEXT NOT NULL,
  photo_url   TEXT,
  bio_short   TEXT,
  order_index INT NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_program_cast ON catalog.program_cast_entries(program_id, order_index);

CREATE TABLE IF NOT EXISTS orders.program_purchases (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id      UUID NOT NULL REFERENCES orders.orders(id),
  program_id    UUID NOT NULL REFERENCES catalog.event_programs(id),
  price_halire  INT NOT NULL,
  access_token  TEXT UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(16),'hex'),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_program_purchases_order ON orders.program_purchases(order_id);

COMMIT;
