-- Event reviews — buyer rating + komentář po akci.
-- Slouží pro:
--   - Display na event detail page (aggregate score + reviews)
--   - Promoter insight (feedback ze všech akcí)
--   - Personal recommendation signal (high-rated events boost)
--   - Trust signal pro nové buyery

BEGIN;

CREATE TABLE marketing.event_reviews (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID         NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  event_id        UUID         NOT NULL REFERENCES catalog.events(id) ON DELETE CASCADE,
  order_id        UUID         NOT NULL,        -- proof of purchase (nemůže review bez ticket)
  rating          INTEGER      NOT NULL CHECK (rating BETWEEN 1 AND 5),
  title           TEXT,
  body            TEXT,
  is_verified     BOOLEAN      NOT NULL DEFAULT FALSE,  -- attended (ticket scanned)
  is_public       BOOLEAN      NOT NULL DEFAULT TRUE,
  helpful_count   INTEGER      NOT NULL DEFAULT 0,
  promoter_reply  TEXT,
  promoter_reply_at TIMESTAMPTZ,
  hidden_by_admin BOOLEAN      NOT NULL DEFAULT FALSE,  -- moderace
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_event_review UNIQUE (user_id, event_id)
);

CREATE INDEX idx_event_reviews_event
  ON marketing.event_reviews (event_id, created_at DESC)
  WHERE is_public = TRUE AND hidden_by_admin = FALSE;

CREATE INDEX idx_event_reviews_user
  ON marketing.event_reviews (user_id, created_at DESC);

-- Helpful votes — kdo označil review jako užitečnou
CREATE TABLE marketing.event_review_helpful (
  review_id       UUID         NOT NULL REFERENCES marketing.event_reviews(id) ON DELETE CASCADE,
  user_id         UUID         NOT NULL,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  PRIMARY KEY (review_id, user_id)
);

COMMENT ON COLUMN marketing.event_reviews.is_verified IS
  'TRUE = buyer skutečně dorazil (ticket scanned). Vyšší trust pro display.';
COMMENT ON COLUMN marketing.event_reviews.order_id IS
  'Proof of purchase — review nelze bez koupěného lístku, anti-fake-reviews.';

COMMIT;
