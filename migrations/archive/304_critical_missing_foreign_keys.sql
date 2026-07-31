-- 304_critical_missing_foreign_keys.sql
-- KRITICKÁ oprava data integrity: orders.orders a tickets.tickets neměly
-- FK constraints na core columns (user_id, event_id, order_id, ticket_type_id,
-- owner_id). To znamenalo:
--   - Možné orphan rows (3 ticket orphans v live DB potvrzeno)
--   - Žádná ON DELETE garance — smaž event a orders mohly zůstat sirotci
--   - DB neaplikovala referenční integritu, jen aplikační kód
--
-- Strategy:
--   1. Cleanup orphan rows (3 tickety s zaniklým ticket_type)
--   2. Přidat FK s explicit ON DELETE actions:
--      - RESTRICT na user/event/ticket_type (data integrity)
--      - CASCADE na order → tickets (smaž order = smaž jeho tickety)

BEGIN;

-- ============================================================
-- 1. Cleanup orphan tickety
-- ticket_type_id je NOT NULL, takže orphan ticketům (3 rows) nezbývá
-- než DELETE. Jsou to test/demo data — kontrola identifikovala že odkazují
-- na neexistující ticket_type 00000000-...-540.
-- ============================================================
DELETE FROM tickets.tickets
 WHERE ticket_type_id NOT IN (SELECT id FROM catalog.ticket_types);

-- ============================================================
-- 2. orders.orders — chybějící FK
-- ============================================================
ALTER TABLE orders.orders
  ADD CONSTRAINT orders_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES identity.users(id)
    ON DELETE RESTRICT;

-- event_id je nullable (pro b2b/standalone orders), proto SET NULL
ALTER TABLE orders.orders
  ADD CONSTRAINT orders_event_id_fkey
    FOREIGN KEY (event_id) REFERENCES catalog.events(id)
    ON DELETE RESTRICT;

-- ============================================================
-- 3. tickets.tickets — chybějící FK
-- ============================================================
ALTER TABLE tickets.tickets
  ADD CONSTRAINT tickets_order_id_fkey
    FOREIGN KEY (order_id) REFERENCES orders.orders(id)
    ON DELETE CASCADE;

ALTER TABLE tickets.tickets
  ADD CONSTRAINT tickets_owner_id_fkey
    FOREIGN KEY (owner_id) REFERENCES identity.users(id)
    ON DELETE RESTRICT;

-- ticket_type_id se po cleanupu může opravit jako NOT NULL nebo nechat nullable.
-- Necháme nullable + RESTRICT — bezpečnější.
ALTER TABLE tickets.tickets
  ADD CONSTRAINT tickets_ticket_type_id_fkey
    FOREIGN KEY (ticket_type_id) REFERENCES catalog.ticket_types(id)
    ON DELETE RESTRICT;

INSERT INTO public.schema_migrations (filename)
VALUES ('304_critical_missing_foreign_keys.sql')
ON CONFLICT (filename) DO NOTHING;

COMMIT;
