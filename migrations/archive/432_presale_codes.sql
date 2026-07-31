ALTER TABLE catalog.ticket_types ADD COLUMN IF NOT EXISTS presale_starts_at timestamptz;
ALTER TABLE catalog.ticket_types ADD COLUMN IF NOT EXISTS presale_ends_at timestamptz;
ALTER TABLE catalog.ticket_types ADD COLUMN IF NOT EXISTS presale_code text;
ALTER TABLE catalog.ticket_types ADD COLUMN IF NOT EXISTS presale_code_required boolean NOT NULL DEFAULT false;
