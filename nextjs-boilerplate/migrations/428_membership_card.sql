ALTER TABLE catalog.cross_pass_bundles ADD COLUMN IF NOT EXISTS card_color text DEFAULT '#1a1a2e';
ALTER TABLE catalog.cross_pass_bundles ADD COLUMN IF NOT EXISTS card_logo_url text;
ALTER TABLE tickets.cross_pass_memberships ADD COLUMN IF NOT EXISTS card_issued_at timestamptz;
