-- Migration 125: Fan surveys (Feature #193)

CREATE SCHEMA IF NOT EXISTS surveys;

CREATE TABLE surveys.surveys (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id         UUID NOT NULL,              -- ref: catalog.events(id)
  promoter_id      UUID NOT NULL,              -- tenant
  type             TEXT NOT NULL CHECK (type IN ('pre_event', 'post_event', 'nps')),
  title            TEXT NOT NULL,
  description      TEXT,
  questions        JSONB NOT NULL,             -- [ { id, question, type, required, choices? } ]
  status           TEXT NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft', 'active', 'closed')),
  respondent_count INTEGER NOT NULL DEFAULT 0,
  response_rate    NUMERIC(5, 2) NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at        TIMESTAMPTZ
);

CREATE TABLE surveys.survey_responses (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  survey_id       UUID NOT NULL REFERENCES surveys.surveys(id),
  buyer_id        UUID NOT NULL,              -- kupující/návštěvník
  responses       JSONB NOT NULL,             -- { questionId: answer, ... }
  status          TEXT NOT NULL DEFAULT 'completed'
                    CHECK (status IN ('started', 'completed', 'skipped')),
  nps_score       INTEGER CHECK (nps_score BETWEEN 0 AND 10),
  completed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_surveys_event   ON surveys.surveys (event_id);
CREATE INDEX idx_surveys_active  ON surveys.surveys (event_id) WHERE status = 'active';
CREATE INDEX idx_responses_survey ON surveys.survey_responses (survey_id);
CREATE INDEX idx_responses_nps   ON surveys.survey_responses (nps_score)
  WHERE nps_score IS NOT NULL;
