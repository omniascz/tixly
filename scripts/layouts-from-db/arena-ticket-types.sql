BEGIN;

-- Arena Praha event_id = 00000000-0000-4000-a000-000000000404 (Mainstream Tribute Show)
-- Aktualizace counts po rewrite v2 layoutu na 14k kapacitu.

UPDATE catalog.ticket_types SET total_qty = 2400, remaining_qty = 2400
  WHERE event_id = '00000000-0000-4000-a000-000000000404' AND zone = 'PARTER';
UPDATE catalog.ticket_types SET total_qty = 3584, remaining_qty = 3584
  WHERE event_id = '00000000-0000-4000-a000-000000000404' AND zone = 'LB';
UPDATE catalog.ticket_types SET total_qty = 4320, remaining_qty = 4320
  WHERE event_id = '00000000-0000-4000-a000-000000000404' AND zone = 'UB';
UPDATE catalog.ticket_types SET total_qty = 288,  remaining_qty = 288
  WHERE event_id = '00000000-0000-4000-a000-000000000404' AND zone = 'BOX';

-- Nový TL (Top Level) ticket type
INSERT INTO catalog.ticket_types
  (event_id, name, kind, base_price, total_qty, remaining_qty, max_per_user, zone, is_seated, attendance_type)
VALUES (
  '00000000-0000-4000-a000-000000000404',
  'Top Level (300s)', 'seated', 60000, 3136, 3136, 6, 'TL', TRUE, 'physical'
)
ON CONFLICT DO NOTHING;

COMMIT;
