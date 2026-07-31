-- 275_cookie_consent_log.sql
-- Server-side audit trail pro cookie consent (GDPR Art. 7 odst. 1 — burden of proof).
-- Každý consent event (přijetí, odmítnutí, změna) zalogován s timestampem + IP + UA.
-- Retention 90 dní (cron `consent-log-purge`).

BEGIN;

CREATE SCHEMA IF NOT EXISTS compliance;

CREATE TABLE IF NOT EXISTS compliance.cookie_consent_log (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid REFERENCES identity.users(id) ON DELETE SET NULL,
  session_id   text,                              -- pro anonymní visitory
  essential    boolean NOT NULL DEFAULT true,
  analytics    boolean NOT NULL DEFAULT false,
  marketing    boolean NOT NULL DEFAULT false,
  decided_at   timestamptz NOT NULL DEFAULT now(),
  ip_hash      text,                              -- SHA-256(ip), nikoli plain IP (data minimisation)
  user_agent   text,
  source       text NOT NULL DEFAULT 'banner'     -- 'banner' | 'settings-page' | 'reset'
                 CHECK (source IN ('banner', 'settings-page', 'reset', 'api'))
);

CREATE INDEX IF NOT EXISTS idx_consent_log_user ON compliance.cookie_consent_log(user_id, decided_at DESC);
CREATE INDEX IF NOT EXISTS idx_consent_log_session ON compliance.cookie_consent_log(session_id, decided_at DESC);
CREATE INDEX IF NOT EXISTS idx_consent_log_purge ON compliance.cookie_consent_log(decided_at);

COMMENT ON TABLE compliance.cookie_consent_log IS
  'GDPR Art. 7 audit trail. IP se ukládá pouze jako SHA-256 hash (data minimisation).';

COMMIT;
