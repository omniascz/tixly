-- 273_audit_log_platform_admin.sql
--
-- Rozšiřuje audit.audit_log.actor_type CHECK constraint o 'platform_admin'.
-- 9 platform admin endpointů (PATCH promotér, KYC, venue seating, reports, ...)
-- zapisuje s actor_type='platform_admin' aby semantika odlišovala master tenant
-- od běžného admin role. Bez tohoto rozšíření padaly všechny PATCH operace
-- s "audit_log_actor_type_check" violation.

BEGIN;

ALTER TABLE audit.audit_log
  DROP CONSTRAINT IF EXISTS audit_log_actor_type_check;

ALTER TABLE audit.audit_log
  ADD CONSTRAINT audit_log_actor_type_check
  CHECK (actor_type IN ('user', 'system', 'admin', 'platform_admin', 'gate'));

COMMIT;
