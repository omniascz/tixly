CREATE TABLE IF NOT EXISTS identity.saved_payment_methods (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  provider        text NOT NULL DEFAULT 'gopay',
  token           text NOT NULL,
  card_mask       text,
  card_brand      text,
  expires_month   int,
  expires_year    int,
  is_default      boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  last_used_at    timestamptz,
  UNIQUE(user_id, token)
);

CREATE INDEX IF NOT EXISTS idx_saved_pm_user ON identity.saved_payment_methods(user_id);

ALTER TABLE identity.saved_payment_methods ENABLE ROW LEVEL SECURITY;
CREATE POLICY spm_owner ON identity.saved_payment_methods
  USING (user_id::text = current_setting('app.current_user_id', true));
