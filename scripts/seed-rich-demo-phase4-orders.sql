-- Phase 4: 8 kupcu + 18 objednavek + listky + sold-out flag pro nektere eventy
-- Pozn: TOTP secret je placeholder (32B nul) — seed listky nelze skenovat pres TOTP,
-- ale ticket detail v adminu bude fungovat. Skutecne TOTP listky vznikaji pres realny checkout.

BEGIN;

-- ===== 1) 8 demo kupcu =====
INSERT INTO identity.users (id, email, name, password_hash, phone, email_verified_at, gdpr_consent_at, is_platform_admin)
VALUES
  ('00000000-0000-4000-a000-000000000600', 'anna.nova@example.cz',         'Anna Nova',          '$2b$10$.GIsSaNWGnm/jz38S.x.9eFd5OFpWjxYLNfa1DRIBL2ZcNh3t056S', '+420777111000', NOW(), NOW(), false),
  ('00000000-0000-4000-a000-000000000601', 'petr.standard@example.cz',     'Petr Standard',      '$2b$10$.GIsSaNWGnm/jz38S.x.9eFd5OFpWjxYLNfa1DRIBL2ZcNh3t056S', '+420777111001', NOW(), NOW(), false),
  ('00000000-0000-4000-a000-000000000602', 'marie.refundova@example.cz',   'Marie Refundova',    '$2b$10$.GIsSaNWGnm/jz38S.x.9eFd5OFpWjxYLNfa1DRIBL2ZcNh3t056S', '+420777111002', NOW(), NOW(), false),
  ('00000000-0000-4000-a000-000000000603', 'tomas.reseller@example.cz',    'Tomas Reseller',     '$2b$10$.GIsSaNWGnm/jz38S.x.9eFd5OFpWjxYLNfa1DRIBL2ZcNh3t056S', '+420777111003', NOW(), NOW(), false),
  ('00000000-0000-4000-a000-000000000604', 'eva.predplatitelka@example.cz','Eva Predplatitelka', '$2b$10$.GIsSaNWGnm/jz38S.x.9eFd5OFpWjxYLNfa1DRIBL2ZcNh3t056S', '+420777111004', NOW(), NOW(), false),
  ('00000000-0000-4000-a000-000000000605', 'fanda.fanousek@example.cz',    'Fanda Fanousek',     '$2b$10$.GIsSaNWGnm/jz38S.x.9eFd5OFpWjxYLNfa1DRIBL2ZcNh3t056S', '+420777111005', NOW(), NOW(), false),
  ('00000000-0000-4000-a000-000000000606', 'lucie.lajner@example.cz',      'Lucie Lajner',       '$2b$10$.GIsSaNWGnm/jz38S.x.9eFd5OFpWjxYLNfa1DRIBL2ZcNh3t056S', '+420777111006', NOW(), NOW(), false),
  ('00000000-0000-4000-a000-000000000607', 'jakub.host@example.cz',        'Jakub Host',         '$2b$10$.GIsSaNWGnm/jz38S.x.9eFd5OFpWjxYLNfa1DRIBL2ZcNh3t056S', '+420777111007', NOW(), NOW(), false)
ON CONFLICT (id) DO NOTHING;

-- ===== 2) Helper funkce: vyrob objednavku + listky + oznac event_seats jako sold =====
-- Vstup: order_id, user_id, event_id, ticket_type_id, status, list of (sector,row,seat_number)
-- Pozn: zadny FOR UPDATE — jen seed, jednovlaknovy

CREATE OR REPLACE FUNCTION pg_temp.create_paid_order(
  p_order_id uuid,
  p_user_id uuid,
  p_event_id uuid,
  p_ticket_type_id uuid,
  p_status text,
  p_paid_at timestamp with time zone,
  p_seats text[][] -- pole [[sector,row,num], ...]
)
RETURNS integer AS $$
DECLARE
  v_unit_price integer;
  v_total integer;
  v_qty integer;
  v_seat_arr text[];
  v_event_seat_id uuid;
  v_ticket_id uuid;
  v_count integer := 0;
  v_placeholder_secret bytea := '\x' || repeat('00', 32);
  v_placeholder_iv bytea := '\x' || repeat('00', 16);
BEGIN
  SELECT base_price INTO v_unit_price FROM catalog.ticket_types WHERE id = p_ticket_type_id;
  v_qty := array_length(p_seats, 1);
  v_total := v_unit_price * v_qty;

  -- Order
  INSERT INTO orders.orders (id, user_id, status, total_amount, currency, locale, expires_at, paid_at, event_id, payment_provider, idempotency_key)
  VALUES (p_order_id, p_user_id, p_status, v_total, 'CZK', 'cs', p_paid_at + INTERVAL '7 minutes', p_paid_at, p_event_id, 'gopay', gen_random_uuid())
  ON CONFLICT (id) DO NOTHING;

  -- Order item
  INSERT INTO orders.order_items (order_id, ticket_type_id, quantity, unit_price, total_price)
  VALUES (p_order_id, p_ticket_type_id, v_qty, v_unit_price, v_total)
  ON CONFLICT DO NOTHING;

  -- Pro kazde sedadlo: oznac event_seat jako sold a vyrob ticket
  FOREACH v_seat_arr SLICE 1 IN ARRAY p_seats LOOP
    SELECT id INTO v_event_seat_id
    FROM catalog.event_seats
    WHERE event_id = p_event_id AND sector = v_seat_arr[1] AND row = v_seat_arr[2] AND seat_number = v_seat_arr[3]
    LIMIT 1;
    IF v_event_seat_id IS NULL THEN
      RAISE NOTICE 'Skip: seat % not found for event %', v_seat_arr, p_event_id;
      CONTINUE;
    END IF;

    UPDATE catalog.event_seats SET status = 'sold', order_id = p_order_id, updated_at = NOW() WHERE id = v_event_seat_id;

    v_ticket_id := gen_random_uuid();
    INSERT INTO tickets.tickets (id, order_id, ticket_type_id, owner_id, original_owner_id, event_seat_id, status, totp_secret_encrypted, totp_secret_iv, original_price, transfer_count)
    VALUES (v_ticket_id, p_order_id, p_ticket_type_id, p_user_id, p_user_id, v_event_seat_id, CASE WHEN p_status = 'paid' THEN 'valid' WHEN p_status = 'refunded' THEN 'revoked' ELSE 'valid' END, v_placeholder_secret, v_placeholder_iv, v_unit_price, 0)
    ON CONFLICT (id) DO NOTHING;
    v_count := v_count + 1;
  END LOOP;

  -- Update remaining_qty
  UPDATE catalog.ticket_types SET remaining_qty = remaining_qty - v_qty WHERE id = p_ticket_type_id AND remaining_qty >= v_qty;

  RETURN v_count;
END;
$$ LANGUAGE plpgsql;

-- ===== 3) 18 objednavek =====
-- Romeo a Julie (event 401) — 4 paid, 1 refunded, 1 resale
SELECT 'Anna 4x Romeo Prizemi'    as obj, pg_temp.create_paid_order('00000000-0000-4000-a000-000000000700','00000000-0000-4000-a000-000000000600','00000000-0000-4000-a000-000000000401','00000000-0000-4000-a000-0000000005a1','paid', '2026-04-15 14:23:00+02', ARRAY[['PŘÍZEMÍ','5','12'],['PŘÍZEMÍ','5','13']]) as listku;
SELECT 'Petr 2x Romeo Balkon'     as obj, pg_temp.create_paid_order('00000000-0000-4000-a000-000000000701','00000000-0000-4000-a000-000000000601','00000000-0000-4000-a000-000000000401','00000000-0000-4000-a000-0000000005a2','paid', '2026-04-18 09:15:00+02', ARRAY[['BALKON STŘED','1','5'],['BALKON STŘED','1','6']]) as listku;
SELECT 'Eva 2x Romeo Prizemi'     as obj, pg_temp.create_paid_order('00000000-0000-4000-a000-000000000702','00000000-0000-4000-a000-000000000604','00000000-0000-4000-a000-000000000401','00000000-0000-4000-a000-0000000005a1','paid', '2026-04-20 19:30:00+02', ARRAY[['PŘÍZEMÍ','3','8'],['PŘÍZEMÍ','3','9']]) as listku;
SELECT 'Marie 1x Romeo refunded'  as obj, pg_temp.create_paid_order('00000000-0000-4000-a000-000000000703','00000000-0000-4000-a000-000000000602','00000000-0000-4000-a000-000000000401','00000000-0000-4000-a000-0000000005a1','refunded', '2026-04-12 16:00:00+02', ARRAY[['PŘÍZEMÍ','7','10']]) as listku;

-- Hamlet (402) — 2 paid
SELECT 'Anna 2x Hamlet'   as obj, pg_temp.create_paid_order('00000000-0000-4000-a000-000000000710','00000000-0000-4000-a000-000000000600','00000000-0000-4000-a000-000000000402','00000000-0000-4000-a000-0000000005b1','paid', '2026-04-22 10:00:00+02', ARRAY[['PŘÍZEMÍ','5','14'],['PŘÍZEMÍ','5','15']]) as listku;
SELECT 'Fanda 1x Hamlet'  as obj, pg_temp.create_paid_order('00000000-0000-4000-a000-000000000711','00000000-0000-4000-a000-000000000605','00000000-0000-4000-a000-000000000402','00000000-0000-4000-a000-0000000005b3','paid', '2026-04-23 11:30:00+02', ARRAY[['BALKON VLEVO','1','3']]) as listku;

-- Symfonicky koncert (403) — 3 paid (VIP, Parter, Balkon)
-- POZN. (oprava 2026-06-01): sektory/sedadla srovnány s velky-sal layoutem (chart 301)
-- a ticket_type IDs odpovídají zónám (510=PARTER, 511=BALKON, 513=LP) — dřív odkazovaly
-- neexistující sektory LOZE/BALKON STREDNI (403 tehdy neměl žádný chart → seedem přeskočeno).
SELECT 'Anna Parter'    as obj, pg_temp.create_paid_order('00000000-0000-4000-a000-000000000720','00000000-0000-4000-a000-000000000600','00000000-0000-4000-a000-000000000403','00000000-0000-4000-a000-000000000510','paid', '2026-04-10 08:00:00+02', ARRAY[['PARTER','1','1'],['PARTER','1','2']]) as listku;
SELECT 'Eva Balkon'     as obj, pg_temp.create_paid_order('00000000-0000-4000-a000-000000000721','00000000-0000-4000-a000-000000000604','00000000-0000-4000-a000-000000000403','00000000-0000-4000-a000-000000000511','paid', '2026-04-11 14:20:00+02', ARRAY[['BALKON I','B1-1','1']]) as listku;
SELECT 'Lucie Loze'     as obj, pg_temp.create_paid_order('00000000-0000-4000-a000-000000000722','00000000-0000-4000-a000-000000000606','00000000-0000-4000-a000-000000000403','00000000-0000-4000-a000-000000000513','paid', '2026-04-25 13:00:00+02', ARRAY[['LP-1','A','1'],['LP-1','A','2']]) as listku;

-- Mainstream Arena (404) — 2 paid
SELECT 'Anna VIP Box'    as obj, pg_temp.create_paid_order('00000000-0000-4000-a000-000000000730','00000000-0000-4000-a000-000000000600','00000000-0000-4000-a000-000000000404','00000000-0000-4000-a000-000000000523','paid', '2026-04-15 12:00:00+02', ARRAY[['BOX-1','1','1'],['BOX-1','1','2']]) as listku;
SELECT 'Petr LB-101'     as obj, pg_temp.create_paid_order('00000000-0000-4000-a000-000000000731','00000000-0000-4000-a000-000000000601','00000000-0000-4000-a000-000000000404','00000000-0000-4000-a000-000000000521','paid', '2026-04-16 13:45:00+02', ARRAY[['LB-101','R1','10'],['LB-101','R1','11']]) as listku;

-- Punk Underground (406, standing) — 2 paid bez sedadel
INSERT INTO orders.orders (id, user_id, status, total_amount, currency, locale, expires_at, paid_at, event_id, payment_provider, idempotency_key)
VALUES
  ('00000000-0000-4000-a000-000000000740','00000000-0000-4000-a000-000000000605','paid', 70000,'CZK','cs','2026-04-26 14:00:00+02','2026-04-26 13:53:00+02','00000000-0000-4000-a000-000000000406','gopay', gen_random_uuid()),
  ('00000000-0000-4000-a000-000000000741','00000000-0000-4000-a000-000000000601','paid', 35000,'CZK','cs','2026-04-27 18:10:00+02','2026-04-27 18:03:00+02','00000000-0000-4000-a000-000000000406','gopay', gen_random_uuid())
ON CONFLICT (id) DO NOTHING;
INSERT INTO orders.order_items (order_id, ticket_type_id, quantity, unit_price, total_price) VALUES
  ('00000000-0000-4000-a000-000000000740','00000000-0000-4000-a000-000000000540',2,35000,70000),
  ('00000000-0000-4000-a000-000000000741','00000000-0000-4000-a000-000000000540',1,35000,35000)
ON CONFLICT DO NOTHING;
INSERT INTO tickets.tickets (id, order_id, ticket_type_id, owner_id, original_owner_id, status, totp_secret_encrypted, totp_secret_iv, original_price)
VALUES
  (gen_random_uuid(),'00000000-0000-4000-a000-000000000740','00000000-0000-4000-a000-000000000540','00000000-0000-4000-a000-000000000605','00000000-0000-4000-a000-000000000605','valid', '\x0000000000000000000000000000000000000000000000000000000000000000','\x00000000000000000000000000000000', 35000),
  (gen_random_uuid(),'00000000-0000-4000-a000-000000000740','00000000-0000-4000-a000-000000000540','00000000-0000-4000-a000-000000000605','00000000-0000-4000-a000-000000000605','valid', '\x0000000000000000000000000000000000000000000000000000000000000000','\x00000000000000000000000000000000', 35000),
  (gen_random_uuid(),'00000000-0000-4000-a000-000000000741','00000000-0000-4000-a000-000000000540','00000000-0000-4000-a000-000000000601','00000000-0000-4000-a000-000000000601','valid', '\x0000000000000000000000000000000000000000000000000000000000000000','\x00000000000000000000000000000000', 35000)
ON CONFLICT (id) DO NOTHING;
UPDATE catalog.ticket_types SET remaining_qty = remaining_qty - 3 WHERE id = '00000000-0000-4000-a000-000000000540';

-- Strindberg minulost (410, sold out) — oznacit vsech 308 event_seats jako sold
UPDATE catalog.event_seats SET status = 'sold', updated_at = NOW() WHERE event_id = '00000000-0000-4000-a000-000000000410';

-- Derby (405, sold out) — oznacit vsech 50000 event_seats jako sold
UPDATE catalog.event_seats SET status = 'sold', updated_at = NOW() WHERE event_id = '00000000-0000-4000-a000-000000000405';

-- 1 pending objednavka (Petr, koncert, jeste neuhrazene)
INSERT INTO orders.orders (id, user_id, status, total_amount, currency, locale, expires_at, event_id, payment_provider, idempotency_key, created_at)
VALUES
  ('00000000-0000-4000-a000-000000000750','00000000-0000-4000-a000-000000000601','pending', 250000,'CZK','cs', NOW() + INTERVAL '5 minutes', '00000000-0000-4000-a000-000000000403','gopay', gen_random_uuid(), NOW())
ON CONFLICT (id) DO NOTHING;

-- 1 expired objednavka
INSERT INTO orders.orders (id, user_id, status, total_amount, currency, locale, expires_at, event_id, payment_provider, idempotency_key, created_at)
VALUES
  ('00000000-0000-4000-a000-000000000751','00000000-0000-4000-a000-000000000606','expired', 60000,'CZK','cs', '2026-04-25 17:30:00+02', '00000000-0000-4000-a000-000000000403','gopay', gen_random_uuid(), '2026-04-25 17:23:00+02')
ON CONFLICT (id) DO NOTHING;

COMMIT;

-- Overeni
SELECT
  (SELECT COUNT(*) FROM identity.users WHERE id::text LIKE '00000000-0000-4000-a000-00000000060%') as kupcu,
  (SELECT COUNT(*) FROM orders.orders WHERE id::text LIKE '00000000-0000-4000-a000-00000000007%') as objednavek,
  (SELECT COUNT(*) FROM tickets.tickets t JOIN orders.orders o ON o.id = t.order_id WHERE o.id::text LIKE '00000000-0000-4000-a000-00000000007%') as listku,
  (SELECT COUNT(*) FROM catalog.event_seats WHERE status = 'sold') as sold_seats;

SELECT o.id, u.name as kupec, e.title, o.status, o.total_amount/100 as kc, COUNT(t.id) as listku
FROM orders.orders o
JOIN identity.users u ON u.id = o.user_id
LEFT JOIN catalog.events e ON e.id = o.event_id
LEFT JOIN tickets.tickets t ON t.order_id = o.id
WHERE o.id::text LIKE '00000000-0000-4000-a000-00000000007%'
GROUP BY o.id, u.name, e.title, o.status, o.total_amount, o.created_at
ORDER BY o.created_at;
