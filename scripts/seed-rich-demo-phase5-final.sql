-- Phase 5: promo kody + resale listings + final report
BEGIN;

-- ===== Promo kody (3 ks pro Demo Promotera) =====
INSERT INTO marketing.promo_codes (id, code, type, discount_value, max_uses, uses_count, valid_from, valid_until, active, created_by_organizer_id)
VALUES
  ('00000000-0000-4000-a000-000000000801', 'DIVADLO20',  'percentage', 20, 100, 0,  NOW() - INTERVAL '7 days', NOW() + INTERVAL '60 days', true,  '00000000-0000-4000-a000-000000000111'),
  ('00000000-0000-4000-a000-000000000802', 'DOLE100',    'fixed',      10000, 50, 30, NOW() - INTERVAL '14 days',NOW() + INTERVAL '30 days', true,  '00000000-0000-4000-a000-000000000111'),
  ('00000000-0000-4000-a000-000000000803', 'EXPIRED2025','percentage', 50, 200, 200, '2025-01-01', '2025-12-31', false, '00000000-0000-4000-a000-000000000112')
ON CONFLICT (id) DO NOTHING;

-- ===== Resale listings — Tomas Reseller predprodava 1 listek =====
-- Najdi listek Tomase nebo vyrob (ze Symphony 720 listku Anny prevezmeme jeden)
-- Tomas si listek koupil, pak ho dava na resale za niz puvodni cena (price cap test)
INSERT INTO orders.orders (id, user_id, status, total_amount, currency, locale, expires_at, paid_at, event_id, payment_provider, idempotency_key)
VALUES
  ('00000000-0000-4000-a000-000000000760','00000000-0000-4000-a000-000000000603','paid', 180000,'CZK','cs','2026-04-19 16:30:00+02','2026-04-19 16:23:00+02','00000000-0000-4000-a000-000000000403','gopay', gen_random_uuid())
ON CONFLICT (id) DO NOTHING;
INSERT INTO orders.order_items (order_id, ticket_type_id, quantity, unit_price, total_price)
VALUES
  ('00000000-0000-4000-a000-000000000760','00000000-0000-4000-a000-000000000511',1,180000,180000)
ON CONFLICT DO NOTHING;

-- Vyrob ticket pro Tomase a oznac ho jako resale_listed
DO $$
DECLARE
  v_event_seat_id uuid;
  v_ticket_id uuid := '00000000-0000-4000-a000-000000000770';
BEGIN
  SELECT id INTO v_event_seat_id FROM catalog.event_seats
  WHERE event_id = '00000000-0000-4000-a000-000000000403' AND sector = 'PARTER' AND row = '5' AND seat_number = '14'
  LIMIT 1;

  IF v_event_seat_id IS NOT NULL THEN
    UPDATE catalog.event_seats SET status = 'sold', order_id = '00000000-0000-4000-a000-000000000760', updated_at = NOW() WHERE id = v_event_seat_id;
    INSERT INTO tickets.tickets (id, order_id, ticket_type_id, owner_id, original_owner_id, event_seat_id, status, totp_secret_encrypted, totp_secret_iv, original_price, transfer_count)
    VALUES (v_ticket_id, '00000000-0000-4000-a000-000000000760', '00000000-0000-4000-a000-000000000511', '00000000-0000-4000-a000-000000000603', '00000000-0000-4000-a000-000000000603', v_event_seat_id, 'resale_listed', '\x0000000000000000000000000000000000000000000000000000000000000000', '\x00000000000000000000000000000000', 180000, 0)
    ON CONFLICT (id) DO NOTHING;
  END IF;
END $$;

UPDATE catalog.ticket_types SET remaining_qty = remaining_qty - 1 WHERE id = '00000000-0000-4000-a000-000000000511';

-- ===== Branding pro promotery (logo + barva uz mame; doplnim brand_logo_url placeholder) =====
UPDATE platform.promoters SET brand_logo_url = 'https://placehold.co/200x60/8b5a2b/white?text=Divadlo+Hranice' WHERE id = '00000000-0000-4000-a000-000000000111';
UPDATE platform.promoters SET brand_logo_url = 'https://placehold.co/200x60/1e40af/white?text=National+Concert' WHERE id = '00000000-0000-4000-a000-000000000112';
UPDATE platform.promoters SET brand_logo_url = 'https://placehold.co/200x60/dc2626/white?text=MultiArena' WHERE id = '00000000-0000-4000-a000-000000000113';
UPDATE platform.promoters SET brand_logo_url = 'https://placehold.co/200x60/7c3aed/white?text=Underground' WHERE id = '00000000-0000-4000-a000-000000000114';

COMMIT;

-- ===== FINAL REPORT =====
\echo '======================================'
\echo '  TIXLY DEMO — STAV PO SEED COMPLETE'
\echo '======================================'

\echo '--- 1) Promotéři ---'
SELECT name, status, slug, brand_color_hex FROM platform.promoters ORDER BY name;

\echo '--- 2) Sály (kde jsou seating charty) ---'
SELECT v.name, v.city, v.capacity, v.venue_type, p.name as promoter,
       (SELECT total_seats FROM catalog.venue_seating_charts WHERE venue_id = v.id AND active = true LIMIT 1) as chart_seats
FROM catalog.venues v
LEFT JOIN platform.promoters p ON p.id = v.promoter_id
WHERE v.archived_at IS NULL
ORDER BY v.capacity;

\echo '--- 3) Akce (10 ks v různých stavech) ---'
SELECT e.title, v.name as venue, e.status, e.date_start::date as datum,
       COUNT(DISTINCT tt.id) as types,
       COUNT(es.id) as event_seats,
       COUNT(es.id) FILTER (WHERE es.status='sold') as sold
FROM catalog.events e
JOIN catalog.venues v ON v.id = e.venue_id
LEFT JOIN catalog.ticket_types tt ON tt.event_id = e.id
LEFT JOIN catalog.event_seats es ON es.event_id = e.id
WHERE e.id::text LIKE '00000000-0000-4000-a000-0000000004%'
GROUP BY e.id, e.title, v.name, e.status, e.date_start
ORDER BY e.date_start;

\echo '--- 4) Kupci ---'
SELECT u.name, u.email, COUNT(DISTINCT o.id) as objednavek, SUM(o.total_amount) FILTER (WHERE o.status='paid')/100 as utraceno_kc
FROM identity.users u
LEFT JOIN orders.orders o ON o.user_id = u.id
WHERE u.id::text LIKE '00000000-0000-4000-a000-00000000060%'
GROUP BY u.id, u.name, u.email
ORDER BY u.name;

\echo '--- 5) Objednávky podle stavu ---'
SELECT o.status, COUNT(*) as poctu, SUM(o.total_amount)/100 as celkem_kc
FROM orders.orders o
WHERE o.user_id::text LIKE '00000000-0000-4000-a000-00000000060%'
GROUP BY o.status
ORDER BY poctu DESC;

\echo '--- 6) Promo kódy ---'
SELECT code, type, discount_value, uses_count, max_uses, active FROM marketing.promo_codes WHERE id::text LIKE '00000000-0000-4000-a000-0000000008%';

\echo '--- 7) Resale listings ---'
SELECT t.id, u.name as prodavajici, e.title as akce, t.original_price/100 as cena_kc, t.status
FROM tickets.tickets t
JOIN identity.users u ON u.id = t.owner_id
JOIN orders.orders o ON o.id = t.order_id
LEFT JOIN catalog.events e ON e.id = o.event_id
WHERE t.status = 'resale_listed';

\echo '--- 8) Sold seats summary ---'
SELECT v.name, COUNT(*) FILTER (WHERE es.status='sold') as sold, COUNT(*) FILTER (WHERE es.status='available') as available
FROM catalog.event_seats es
JOIN catalog.events e ON e.id = es.event_id
JOIN catalog.venues v ON v.id = e.venue_id
GROUP BY v.id, v.name
ORDER BY COUNT(*) DESC;
