-- Migration 126: Checkout custom questions (Feature #64)

CREATE SCHEMA IF NOT EXISTS checkout;

CREATE TABLE checkout.custom_questions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id     UUID NOT NULL,              -- ref: catalog.events(id)
  promoter_id  UUID NOT NULL,              -- tenant
  label        TEXT NOT NULL,              -- "Jakého si přeješ menu?" nebo "Velikost trička"
  type         TEXT NOT NULL CHECK (type IN ('text', 'choice', 'checkbox', 'rating', 'date')),
  required     BOOLEAN NOT NULL DEFAULT false,
  choices      TEXT[],                     -- pro choice/checkbox typy
  position     INTEGER NOT NULL DEFAULT 0, -- pořadí v checkoutu
  enabled      BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE checkout.question_responses (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id  UUID NOT NULL REFERENCES checkout.custom_questions(id),
  order_id     UUID NOT NULL,              -- ref: orders.orders(id)
  buyer_id     UUID NOT NULL,              -- ref: users(id)
  answer       JSONB NOT NULL,             -- JSON stringified (text, array, bool, number)
  responded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_questions_event ON checkout.custom_questions (event_id, promoter_id);
CREATE INDEX idx_responses_question ON checkout.question_responses (question_id);
CREATE INDEX idx_responses_order ON checkout.question_responses (order_id);
