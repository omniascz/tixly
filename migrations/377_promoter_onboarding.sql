BEGIN;

CREATE TABLE IF NOT EXISTS platform.promoter_onboarding (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  promoter_id       UUID NOT NULL REFERENCES platform.promoters(id) ON DELETE CASCADE UNIQUE,
  current_step      INT NOT NULL DEFAULT 1,
  completed_steps   JSONB NOT NULL DEFAULT '[]',
  -- data průběžně ukládaná mezi kroky
  step_data         JSONB NOT NULL DEFAULT '{}',
  completed_at      TIMESTAMPTZ,
  skipped_at        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Rozšíření promoters tabulky o divadelní specifika pokud sloupce chybí
ALTER TABLE platform.promoters
  ADD COLUMN IF NOT EXISTS phone          TEXT,
  ADD COLUMN IF NOT EXISTS website        TEXT,
  ADD COLUMN IF NOT EXISTS description    TEXT,
  ADD COLUMN IF NOT EXISTS logo_url       TEXT,
  ADD COLUMN IF NOT EXISTS press_email    TEXT,
  ADD COLUMN IF NOT EXISTS iban           TEXT,
  ADD COLUMN IF NOT EXISTS bank_name      TEXT,
  ADD COLUMN IF NOT EXISTS onboarding_done BOOLEAN NOT NULL DEFAULT false;

COMMIT;
