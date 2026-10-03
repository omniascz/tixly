-- 484_payment_paid_once.sql — kolo 2 / S1: jedna platba = jeden záznam payment_paid
--
-- Audit P5d/C2b: každé doručení webhooku zapsalo nový řádek event_type='payment_paid'
-- (3 webhooky = 3 řádky) → přehledy/exporty počítající platby z payment_events je násobí.
--
-- orders.payment_events je NEMĚNNÁ (triggery zakazují UPDATE/DELETE) a historické duplikáty
-- mohou existovat → unikátní index přímo na (order_id) by nad stávajícím schématem nešel založit
-- bez přepisu historie. Proto:
--   * nový sloupec dedupe_key (NULL u historických řádků),
--   * BEFORE INSERT trigger ho pro payment_paid nastaví na 'payment_paid:<order_id>',
--   * parciální UNIQUE index na dedupe_key → druhý payment_paid pro tutéž objednávku nevznikne;
--     zápisy v kódu používají ON CONFLICT DO NOTHING (idempotentní, webhook neodpoví 5xx).
-- Historické duplikáty zůstávají (neměnný log) — nové už vzniknout nemohou. Idempotentní.

BEGIN;

ALTER TABLE orders.payment_events ADD COLUMN IF NOT EXISTS dedupe_key text;

CREATE OR REPLACE FUNCTION orders.payment_events_dedupe_key()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.event_type = 'payment_paid' AND NEW.dedupe_key IS NULL THEN
    NEW.dedupe_key := 'payment_paid:' || NEW.order_id::text;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_payment_events_dedupe_key ON orders.payment_events;
CREATE TRIGGER trg_payment_events_dedupe_key
  BEFORE INSERT ON orders.payment_events
  FOR EACH ROW EXECUTE FUNCTION orders.payment_events_dedupe_key();

CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_events_dedupe_key
  ON orders.payment_events (dedupe_key) WHERE dedupe_key IS NOT NULL;

COMMIT;
