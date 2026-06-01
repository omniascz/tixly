-- RLS Fáze 2 — schema split: password_hash z identity.users do identity.user_secrets.
--
-- PROBLÉM: identity.users měla RLS=off, protože 91 routes JOINuje users kvůli
-- jménu/emailu (recenze, přátelé, zákazníci promotéra). Naivní restriktivní RLS
-- by je rozbila. Ale s RLS=off může pod enforce jakýkoli kontext číst password_hash.
--
-- ŘEŠENÍ: citlivý password_hash přesunout do identity.user_secrets se STRIKTNÍM
-- own/service RLS. identity.users (jméno/email/profil — žádné secrets) pak dostane
-- permisivní read (JOINy fungují) + scoped write. Zápisy password_hash se
-- automaticky přesměrují DB triggerem → aplikační kód (kromě login) se nemění.

-- 1) Tabulka secrets
CREATE TABLE IF NOT EXISTS identity.user_secrets (
  user_id       uuid PRIMARY KEY REFERENCES identity.users(id) ON DELETE CASCADE,
  password_hash text NOT NULL,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- 2) Přenos existujících hashů
INSERT INTO identity.user_secrets (user_id, password_hash)
SELECT id, password_hash FROM identity.users WHERE password_hash IS NOT NULL
ON CONFLICT (user_id) DO NOTHING;

-- 3) users.password_hash → nullable + vyčistit (secret žije už jen v user_secrets)
ALTER TABLE identity.users ALTER COLUMN password_hash DROP NOT NULL;
UPDATE identity.users SET password_hash = NULL WHERE password_hash IS NOT NULL;

-- 4) Trigger: jakýkoli zápis password_hash do users se přesměruje do user_secrets
--    a v users se vynuluje. Pokrývá guest-checkout INSERTy i reset-password UPDATE
--    i gdpr '!deleted' UPDATE → aplikační zápisy se nemusí měnit.
--    SECURITY DEFINER (owner = superuser) → píše user_secrets bez ohledu na RLS.
CREATE OR REPLACE FUNCTION identity.move_password_to_secrets()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = identity, public
AS $$
BEGIN
  INSERT INTO identity.user_secrets (user_id, password_hash, updated_at)
  VALUES (NEW.id, NEW.password_hash, now())
  ON CONFLICT (user_id) DO UPDATE
    SET password_hash = EXCLUDED.password_hash, updated_at = now();
  -- vynuluj v users (tento UPDATE má password_hash NULL → WHEN podmínka false → bez rekurze)
  UPDATE identity.users SET password_hash = NULL WHERE id = NEW.id;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_move_password ON identity.users;
CREATE TRIGGER trg_move_password
  AFTER INSERT OR UPDATE ON identity.users
  FOR EACH ROW
  WHEN (NEW.password_hash IS NOT NULL)
  EXECUTE FUNCTION identity.move_password_to_secrets();

-- 5) Granty pro app roli (tixly_rls_test dědí přes členství)
GRANT SELECT, INSERT, UPDATE, DELETE ON identity.user_secrets TO tixly_app;

-- 6) RLS na user_secrets — STRIKTNÍ: jen service/admin/vlastník
ALTER TABLE identity.user_secrets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_user_secrets_scope ON identity.user_secrets;
CREATE POLICY p_user_secrets_scope ON identity.user_secrets FOR ALL
  USING (
    app_is_service() OR app_is_platform_admin()
    OR user_id = app_current_user_id()
  )
  WITH CHECK (
    app_is_service() OR app_is_platform_admin()
    OR user_id = app_current_user_id()
  );

-- 7) RLS na identity.users — read PERMISIVNÍ (jméno/email referencované všude,
--    žádné secrets), write SCOPED (service/admin/vlastník).
ALTER TABLE identity.users ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_users_select ON identity.users;
CREATE POLICY p_users_select ON identity.users FOR SELECT USING (true);
DROP POLICY IF EXISTS p_users_write ON identity.users;
CREATE POLICY p_users_write ON identity.users FOR ALL
  USING (
    app_is_service() OR app_is_platform_admin()
    OR id = app_current_user_id()
  )
  WITH CHECK (
    app_is_service() OR app_is_platform_admin()
    OR id = app_current_user_id()
  );
