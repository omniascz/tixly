-- Oprava (2026-06-01, audit P2): TOTP secret a jeho IV musí být konzistentní.
-- tickets.access_tokens a tickets.cross_pass_memberships měly totp_secret_iv
-- NULLABLE nezávisle na totp_secret_encrypted → riziko nedešifrovatelného tokenu
-- (secret bez IV nebo naopak). Místo blanket NOT NULL (secret SMÍ být NULL když
-- TOTP není použito) přidáváme CHECK: IV existuje právě tehdy, když existuje secret.
-- Idempotentní (guard přes pg_constraint).

DO $$
BEGIN
  IF to_regclass('tickets.access_tokens') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_access_tokens_totp_iv_pairing') THEN
    ALTER TABLE tickets.access_tokens
      ADD CONSTRAINT chk_access_tokens_totp_iv_pairing
      CHECK ((totp_secret_encrypted IS NULL) = (totp_secret_iv IS NULL));
  END IF;

  IF to_regclass('tickets.cross_pass_memberships') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_cross_pass_totp_iv_pairing') THEN
    ALTER TABLE tickets.cross_pass_memberships
      ADD CONSTRAINT chk_cross_pass_totp_iv_pairing
      CHECK ((totp_secret_encrypted IS NULL) = (totp_secret_iv IS NULL));
  END IF;
END $$;
