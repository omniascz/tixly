BEGIN;

-- Import jobs — zákazníci importovaní z externího systému (WebTicket, ComNet, CSV)
CREATE TABLE IF NOT EXISTS platform.import_jobs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  promoter_id     UUID NOT NULL REFERENCES platform.promoters(id) ON DELETE CASCADE,
  source          TEXT NOT NULL DEFAULT 'csv'
                    CHECK (source IN ('csv','webticket','colosseum','smsticket','manual')),
  filename        TEXT,
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','processing','completed','failed')),
  total_rows      INT NOT NULL DEFAULT 0,
  imported_users  INT NOT NULL DEFAULT 0,
  skipped_rows    INT NOT NULL DEFAULT 0,
  error_rows      INT NOT NULL DEFAULT 0,
  column_mapping  JSONB NOT NULL DEFAULT '{}',
  errors          JSONB NOT NULL DEFAULT '[]',
  started_at      TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Importovaní zákazníci — enriched user záznamy pro promotéra
CREATE TABLE IF NOT EXISTS platform.promoter_contacts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  promoter_id     UUID NOT NULL REFERENCES platform.promoters(id) ON DELETE CASCADE,
  user_id         UUID REFERENCES identity.users(id),
  email           TEXT NOT NULL,
  name            TEXT NOT NULL,
  phone           TEXT,
  import_source   TEXT,
  import_job_id   UUID REFERENCES platform.import_jobs(id),
  -- historická data z importu
  historical_purchases INT NOT NULL DEFAULT 0,
  historical_spend_halire BIGINT NOT NULL DEFAULT 0,
  first_purchase_at TIMESTAMPTZ,
  last_purchase_at  TIMESTAMPTZ,
  notes           TEXT,
  opted_out       BOOLEAN NOT NULL DEFAULT false,
  opted_out_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (promoter_id, email)
);

CREATE INDEX IF NOT EXISTS idx_promoter_contacts_promoter ON platform.promoter_contacts(promoter_id);
CREATE INDEX IF NOT EXISTS idx_promoter_contacts_email ON platform.promoter_contacts(promoter_id, email);

-- Broadcasts — hromadné emaily celé zákaznické základně
CREATE TABLE IF NOT EXISTS communications.broadcasts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  promoter_id     UUID NOT NULL REFERENCES platform.promoters(id) ON DELETE CASCADE,
  subject         TEXT NOT NULL,
  body            TEXT NOT NULL,
  target          TEXT NOT NULL DEFAULT 'all'
                    CHECK (target IN ('all','buyers_only','contacts_only','subscribers')),
  event_id        UUID REFERENCES catalog.events(id),
  status          TEXT NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft','sending','sent','failed')),
  recipient_count INT,
  sent_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMIT;
