\set ON_ERROR_STOP 0
BEGIN;
SELECT set_config('app.current_promoter_id','78194f93-e0cf-49fa-9823-839c5ca2d94b',true), set_config('app.role','promoter',true);
-- 1) INSERT s RETURNING (jak to dela POS)
INSERT INTO identity.users (email, name, password_hash, gdpr_consent_at) VALUES ('walkin+probe1@x.local','W','!walk-in-no-password',now()) RETURNING id;
ROLLBACK;
BEGIN;
SELECT set_config('app.current_promoter_id','78194f93-e0cf-49fa-9823-839c5ca2d94b',true), set_config('app.role','promoter',true);
-- 2) INSERT bez RETURNING
INSERT INTO identity.users (email, name, password_hash, gdpr_consent_at) VALUES ('walkin+probe2@x.local','W','!walk-in-no-password',now());
SELECT 'insert bez RETURNING prosel';
-- 3) promoter vlozi platform admina s heslem?
INSERT INTO identity.users (email, name, password_hash, gdpr_consent_at, is_platform_admin) VALUES ('evil-admin@x.local','E','$2b$10$abcdefghijklmnopqrstuuabcdefghijklmnopqrstuvwxyz01234',now(), true);
SELECT 'promoter vlozil platform admina';
ROLLBACK;
