-- 450: Double-issuance guard (HANDOFF §1 #4 RACE) — DB-level idempotence backstop (A z A+B).
--
-- Root cause: issueTicketsForOrder dělal read-check (SELECT WHERE order_id) pak M INSERTů
-- bez locku / bez zastřešující tx / bez UNIQUE. Dva souběžné běhy (order-completed webhook +
-- lazy ticket-pdf apod.) → oba vidí 0 → oba vloží M → 2M lístků (naměřeno 6 pro M=3).
--
-- Řešení: DETERMINISTICKÝ per-order/per-type index lístku (ticket_seq) + UNIQUE na
-- (order_id, ticket_type_id, ticket_seq). Issuer vkládá seq = i-tý lístek daného typu
-- + ON CONFLICT DO NOTHING → souběžný duplikát neprojde. UNIQUE je záruka nezávislá na
-- calleru i spojení (kryje i pool fire-and-forget callery, kde advisory lock nefunguje).
--
-- POZOR — ticket_seq je ZÁMĚRNĚ NULLABLE bez defaultu:
--   * Do tickets.tickets vkládá kromě issueru i 6 přímých cest (resale reissue, subscriptions
--     pick/confirm, gift, season-passes, accreditation). Ty seq NEnastavují → zůstane NULL.
--   * Postgres bere v UNIQUE indexu NULL jako distinct → víc řádků (order,tt,NULL) NEkoliduje,
--     takže přímé cesty NErozbijeme. Enforcement platí jen pro lístky s explicitním seq =
--     tj. VÝHRADNĚ issuer (0,1,2,…), přesně kde double-issuance vzniká.
--
-- Backfill je defenzivní (prod tabulka je prázdná; row_number() dá historickým issuer-lístkům
-- distinct seq, takže i případné dřívější duplicity projdou unikátním indexem).

ALTER TABLE tickets.tickets ADD COLUMN IF NOT EXISTS ticket_seq integer;

UPDATE tickets.tickets t
   SET ticket_seq = sub.rn - 1
  FROM (
    SELECT id,
           row_number() OVER (PARTITION BY order_id, ticket_type_id ORDER BY id) AS rn
      FROM tickets.tickets
     WHERE ticket_seq IS NULL
  ) sub
 WHERE t.id = sub.id
   AND t.ticket_seq IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_tickets_order_type_seq
  ON tickets.tickets (order_id, ticket_type_id, ticket_seq);
