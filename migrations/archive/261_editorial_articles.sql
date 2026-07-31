-- Editorial články — kurátorovaný obsah pro discovery.
-- GoOut style: „Top 10 koncertů v dubnu", „Festivalová sezóna 2026".
-- Plat. admin tvoří články, mohou linkovat na konkrétní events.

BEGIN;

CREATE TABLE marketing.editorial_articles (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  slug            TEXT         NOT NULL UNIQUE,
  title           TEXT         NOT NULL,
  excerpt         TEXT,
  body_html       TEXT         NOT NULL,
  cover_image     TEXT,
  category        TEXT,        -- 'koncerty', 'divadlo', 'festivaly', 'tips', 'interview'
  status          TEXT         NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'published', 'archived')),
  author_user_id  UUID,
  reading_time_min INTEGER,
  view_count      INTEGER      NOT NULL DEFAULT 0,
  published_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_editorial_published
  ON marketing.editorial_articles (published_at DESC NULLS LAST)
  WHERE status = 'published';

CREATE INDEX idx_editorial_category
  ON marketing.editorial_articles (category, published_at DESC)
  WHERE status = 'published';

-- M2M article ↔ events (článek může featurovat víc events)
CREATE TABLE marketing.editorial_article_events (
  article_id      UUID         NOT NULL REFERENCES marketing.editorial_articles(id) ON DELETE CASCADE,
  event_id        UUID         NOT NULL,
  display_order   INTEGER      NOT NULL DEFAULT 0,
  PRIMARY KEY (article_id, event_id)
);

CREATE INDEX idx_article_events_event
  ON marketing.editorial_article_events (event_id);

COMMENT ON TABLE marketing.editorial_articles IS
  'Kurátorovaný blog content pro discovery (GoOut/Eventbrite style).';

COMMIT;
