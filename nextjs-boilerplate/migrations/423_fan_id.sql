-- Migration 423: Fan ID / Identity Verification pro resale
-- Kupující musí projít identifikací před prvním nákupem na resale trhu.
-- Fáze 1: soft-KYC (jméno + telefon verifikace). Fáze 2: dokladová verifikace (Veriff apod.).
-- Pro CZ/SK zatím žádný zákon, ale strukturu připravujeme pro soulad s německým FanID zákonem 2024.

CREATE TABLE IF NOT EXISTS orders.identity_verifications (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid        NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  legal_name      text        NOT NULL,                   -- jméno z dokladu
  document_type   text        NOT NULL DEFAULT 'id_card', -- id_card | passport | driving_licence
  document_number text,                                   -- číslo dokladu (hashované)
  document_front_url text,                               -- URL nahraného dokladu (encrypted store)
  selfie_url      text,                                   -- selfie photo (encrypted store)
  status          text        NOT NULL DEFAULT 'pending', -- pending | approved | rejected
  reviewer_notes  text,
  submitted_at    timestamptz NOT NULL DEFAULT now(),
  reviewed_at     timestamptz,
  reviewed_by_id  uuid        REFERENCES identity.users(id),
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Fan ID check flag na users
ALTER TABLE identity.users
  ADD COLUMN IF NOT EXISTS fan_id_verified     boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS fan_id_verified_at  timestamptz;

-- Resale transactions vyžadují fan_id_verified = true (enforced v aplikaci)
-- (Není nutná DB constraint — aplikace to ověřuje)

CREATE INDEX IF NOT EXISTS identity_verifications_user_status_idx
  ON orders.identity_verifications (user_id, status);

-- RLS
ALTER TABLE orders.identity_verifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY identity_verif_own_select ON orders.identity_verifications
  FOR SELECT USING (
    user_id::text = current_setting('app.current_user_id', true)
    OR current_setting('app.is_platform_admin', true) = 'true'
  );

CREATE POLICY identity_verif_own_insert ON orders.identity_verifications
  FOR INSERT WITH CHECK (
    user_id::text = current_setting('app.current_user_id', true)
  );

CREATE POLICY identity_verif_admin_update ON orders.identity_verifications
  FOR UPDATE USING (current_setting('app.is_platform_admin', true) = 'true');
