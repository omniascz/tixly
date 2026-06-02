-- 342_audit_actor_type_promoter.sql
--
-- BUG FIX: runWithPromoterContext() nenastavoval app.role → audit trigger na
-- UPDATE orders/tickets (a dalších) zapisoval actor_type = '' (prázdný string),
-- což poruší audit_log_actor_type_check → KAŽDÁ promotér-context operace, která
-- spustí audit trigger (refund, atd.), padala na HTTP 500.
--
-- Promotér je legitimní typ aktéra — přidáváme 'promoter' do povolených hodnot
-- (vedle code fixu, který runWithPromoterContext nastaví app.role='promoter').
-- Tím jsou akce promotérů v audit logu DISTINKTNĚ dohledatelné (kdo refundoval).

ALTER TABLE audit.audit_log DROP CONSTRAINT IF EXISTS audit_log_actor_type_check;
ALTER TABLE audit.audit_log ADD CONSTRAINT audit_log_actor_type_check
  CHECK (actor_type = ANY (ARRAY['user','system','admin','platform_admin','gate','promoter']));
