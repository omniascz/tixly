-- scripts/staging/seed-demo.sql — demo data turné agentury pro TESTOVACÍ prostředí (kolo 9 / krok 4).
-- NIKDY nespouštět proti produkci (create.sh to hlídá). Idempotentní: pevná UUID + ON CONFLICT DO NOTHING.
--
-- Proměnné psql:  -v promoter_email=… -v promoter_hash='$2b$…' (bcrypt hesla demo pořadatele)
-- Obsah: pořadatel „Turné agentura (DEMO)", 2 místa ve 2 městech (Brno, Ostrava) se sály a plánky,
--        2 inscenace, 4 publikované termíny, ceny po zónách, slevové kategorie, blokace.
\set ON_ERROR_STOP on
BEGIN;

-- pořadatel + účet
INSERT INTO identity.users (id, email, name, password_hash, gdpr_consent_at, created_at, updated_at)
VALUES ('00000000-0000-4000-a000-000000000001', lower(:'promoter_email'), 'Demo pořadatel', :'promoter_hash', now(), now(), now())
ON CONFLICT DO NOTHING;
INSERT INTO platform.promoters (id, name, email, contact_email, slug, status, vat_payer, company_ico, company_dic, company_address, bank_account)
VALUES ('00000000-0000-4000-a000-000000000002', 'Turné agentura (DEMO)', lower(:'promoter_email'), lower(:'promoter_email'),
        'turne-demo', 'active', true, '12345678', 'CZ12345678', 'Celetná 17, 110 00 Praha 1', '123456789/0100')
ON CONFLICT DO NOTHING;
INSERT INTO platform.promoter_members (promoter_id, user_id, role)
SELECT '00000000-0000-4000-a000-000000000002', u.id, 'owner' FROM identity.users u WHERE u.email = lower(:'promoter_email')
ON CONFLICT DO NOTHING;

-- místa a sály (2 města)
INSERT INTO catalog.venue_places (id, promoter_id, name, city, address) VALUES
  ('00000000-0000-4000-a000-000000000101', '00000000-0000-4000-a000-000000000002', 'Městské divadlo Brno', 'Brno', 'Zelný trh 1, Brno'),
  ('00000000-0000-4000-a000-000000000102', '00000000-0000-4000-a000-000000000002', 'Divadlo Petra Bezruče', 'Ostrava', 'Masarykovo nám. 1, Ostrava')
ON CONFLICT DO NOTHING;
INSERT INTO catalog.venues (id, name, city, country, capacity, place_id) VALUES
  ('00000000-0000-4000-a000-000000000201', 'Městské divadlo Brno – Velký sál', 'Brno', 'CZ', 140, '00000000-0000-4000-a000-000000000101'),
  ('00000000-0000-4000-a000-000000000202', 'Divadlo Petra Bezruče – Komorní scéna', 'Ostrava', 'CZ', 60, '00000000-0000-4000-a000-000000000102')
ON CONFLICT DO NOTHING;

-- plánky sálů: Velký sál = přízemí 8×15 (Zóna A) + balkon 2×10 (Zóna B); Komorní scéna = 4×15 (Zóna A)
CREATE OR REPLACE FUNCTION pg_temp.section(p_name text, p_color text, p_rows int, p_seats int, p_y0 int, p_zone text)
RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('name', p_name, 'color', p_color, 'rows', jsonb_agg(
           jsonb_build_object('label', r::text, 'seats', (
             SELECT jsonb_agg(jsonb_build_object('x', 60 + (s - 1) * 30, 'y', p_y0 + (r - 1) * 30, 'num', s::text, 'zone', p_zone) ORDER BY s)
               FROM generate_series(1, p_seats) s)) ORDER BY r))
    FROM generate_series(1, p_rows) r
$$;
INSERT INTO catalog.venue_seating_charts (id, venue_id, name, total_seats, layout)
SELECT '00000000-0000-4000-a000-000000000301', '00000000-0000-4000-a000-000000000201', 'Default', 140,
       jsonb_build_object('sectors', jsonb_build_array(pg_temp.section('Přízemí', '#dc2626', 8, 15, 150, 'za'), pg_temp.section('Balkon', '#2563eb', 2, 10, 450, 'zb')),
                          'zones', '[{"id":"za","name":"Zóna A","color":"#dc2626"},{"id":"zb","name":"Zóna B","color":"#2563eb"}]'::jsonb)
ON CONFLICT DO NOTHING;
INSERT INTO catalog.venue_seating_charts (id, venue_id, name, total_seats, layout)
SELECT '00000000-0000-4000-a000-000000000302', '00000000-0000-4000-a000-000000000202', 'Default', 60,
       jsonb_build_object('sectors', jsonb_build_array(pg_temp.section('Hlediště', '#dc2626', 4, 15, 150, 'za')),
                          'zones', '[{"id":"za","name":"Zóna A","color":"#dc2626"}]'::jsonb)
ON CONFLICT DO NOTHING;

-- inscenace
INSERT INTO catalog.productions (id, promoter_id, title, subtitle, author, director, duration_min, intermission_min, age_rating, genre, description) VALUES
  ('00000000-0000-4000-a000-000000000401', '00000000-0000-4000-a000-000000000002', 'Racek', 'Komedie o čtyřech dějstvích', 'A. P. Čechov', 'Jan Novák', 150, 20, '12+', 'činohra', 'DEMO inscenace pro testovací prostředí.'),
  ('00000000-0000-4000-a000-000000000402', '00000000-0000-4000-a000-000000000002', 'Hamlet', NULL, 'W. Shakespeare', 'Eva Malá', 180, 20, '15+', 'činohra', 'DEMO inscenace pro testovací prostředí.')
ON CONFLICT DO NOTHING;

-- 4 termíny: Racek Brno, Racek Ostrava, Hamlet Brno, Hamlet Ostrava
CREATE TEMP TABLE demo_terms (id uuid, production uuid, venue uuid, chart uuid, title text, days int) ON COMMIT DROP;
INSERT INTO demo_terms VALUES
  ('00000000-0000-4000-a000-000000000501', '00000000-0000-4000-a000-000000000401', '00000000-0000-4000-a000-000000000201', '00000000-0000-4000-a000-000000000301', 'Racek', 21),
  ('00000000-0000-4000-a000-000000000502', '00000000-0000-4000-a000-000000000401', '00000000-0000-4000-a000-000000000202', '00000000-0000-4000-a000-000000000302', 'Racek', 28),
  ('00000000-0000-4000-a000-000000000503', '00000000-0000-4000-a000-000000000402', '00000000-0000-4000-a000-000000000201', '00000000-0000-4000-a000-000000000301', 'Hamlet', 35),
  ('00000000-0000-4000-a000-000000000504', '00000000-0000-4000-a000-000000000402', '00000000-0000-4000-a000-000000000202', '00000000-0000-4000-a000-000000000302', 'Hamlet', 42);
INSERT INTO catalog.events (id, organizer_id, promoter_id, venue_id, production_id, seat_chart_id, title, slug, status, currency, event_type,
                            date_start, date_end, reservations_enabled)
SELECT t.id, '00000000-0000-4000-a000-000000000002', '00000000-0000-4000-a000-000000000002', t.venue, t.production, t.chart, t.title,
       lower(t.title) || '-demo-' || right(t.id::text, 3), 'published', 'CZK', 'theatre',
       date_trunc('day', now()) + make_interval(days => t.days) + interval '19 hours',
       date_trunc('day', now()) + make_interval(days => t.days) + interval '21 hours 30 minutes', true
  FROM demo_terms t
ON CONFLICT DO NOTHING;

-- ceny po zónách (typ vstupenky = zóna)
INSERT INTO catalog.ticket_types (id, event_id, name, kind, base_price, total_qty, remaining_qty, visibility, vat_rate_code, zone, is_seated)
SELECT md5(t.id::text || z.name)::uuid, t.id, z.name, 'standing', z.price, z.qty, z.qty, 'public', 'CZ_REDUCED', z.name, true
  FROM demo_terms t
  JOIN LATERAL (VALUES ('Zóna A', 45000, CASE WHEN t.chart = '00000000-0000-4000-a000-000000000301' THEN 120 ELSE 60 END),
                       ('Zóna B', 30000, 20)) z(name, price, qty)
    ON z.name = 'Zóna A' OR t.chart = '00000000-0000-4000-a000-000000000301'
ON CONFLICT DO NOTHING;

-- sedadla termínů z plánku sálu
INSERT INTO catalog.event_seats (event_id, ticket_type_id, sector, row, seat_number, x_coord, y_coord, status, price_zone)
SELECT t.id, md5(t.id::text || zn.name)::uuid, sec->>'name', rw->>'label', st->>'num', (st->>'x')::int, (st->>'y')::int, 'available', zn.name
  FROM demo_terms t
  JOIN catalog.venue_seating_charts c ON c.id = t.chart,
       jsonb_array_elements(c.layout->'sectors') sec, jsonb_array_elements(sec->'rows') rw, jsonb_array_elements(rw->'seats') st,
       LATERAL (SELECT z->>'name' AS name FROM jsonb_array_elements(c.layout->'zones') z WHERE z->>'id' = st->>'zone') zn
 WHERE NOT EXISTS (SELECT 1 FROM catalog.event_seats e WHERE e.event_id = t.id);

-- slevové kategorie (plné, senior, student, ZTP/P, doprovod ZTP/P) na každém termínu
INSERT INTO catalog.price_categories (id, promoter_id, event_id, code, name, kind, price_mode, price_value, requires_proof, proof_label, sort_order)
SELECT md5(t.id::text || c.code)::uuid, '00000000-0000-4000-a000-000000000002', t.id, c.code, c.name, c.kind, c.mode, c.val, c.proof IS NOT NULL, c.proof, c.ord
  FROM demo_terms t,
       (VALUES ('plne', 'Plné', 'full', 'percent', 10000, NULL, 0), ('senior', 'Senior', 'senior', 'percent', 8000, 'Senior (věk)', 10),
               ('student', 'Student', 'student', 'percent', 7000, 'Student (ISIC)', 20), ('ztpp', 'ZTP/P', 'ztpp', 'percent', 5000, 'ZTP/P', 40),
               ('doprovod-ztpp', 'Doprovod ZTP/P', 'ztpp_companion', 'fixed', 0, NULL, 50)) c(code, name, kind, mode, val, proof, ord)
ON CONFLICT DO NOTHING;

-- blokace na prvním termínu: Firma XY = celý balkon, Tisk = 4 místa v 1. řadě
INSERT INTO catalog.seat_blocks (id, event_id, promoter_id, name, note, color) VALUES
  ('00000000-0000-4000-a000-000000000601', '00000000-0000-4000-a000-000000000501', '00000000-0000-4000-a000-000000000002', 'Firma XY', 'DEMO firemní blok', '#7c3aed'),
  ('00000000-0000-4000-a000-000000000602', '00000000-0000-4000-a000-000000000501', '00000000-0000-4000-a000-000000000002', 'Tisk', 'DEMO novináři', '#dc2626')
ON CONFLICT DO NOTHING;
WITH picked AS (
  SELECT es.id, CASE WHEN es.sector = 'Balkon' THEN '00000000-0000-4000-a000-000000000601'::uuid ELSE '00000000-0000-4000-a000-000000000602'::uuid END AS block
    FROM catalog.event_seats es
   WHERE es.event_id = '00000000-0000-4000-a000-000000000501' AND es.status = 'available'
     AND (es.sector = 'Balkon' OR (es.sector = 'Přízemí' AND es.row = '1' AND es.seat_number IN ('7', '8', '9', '10'))))
, ins AS (
  INSERT INTO catalog.seat_block_seats (block_id, seat_id, promoter_id)
  SELECT block, id, '00000000-0000-4000-a000-000000000002' FROM picked ON CONFLICT DO NOTHING RETURNING seat_id, block_id)
UPDATE catalog.event_seats es SET status = 'blocked', hold_kind = 'block', hold_label = b.name
  FROM ins JOIN catalog.seat_blocks b ON b.id = ins.block_id WHERE es.id = ins.seat_id;
-- blokovaná místa snižují kapacitu (stejně jako lib/theatre/blocks.ts)
UPDATE catalog.ticket_types tt SET remaining_qty = tt.total_qty - (
  SELECT COUNT(*) FROM catalog.event_seats es WHERE es.ticket_type_id = tt.id AND es.status = 'blocked')
 WHERE tt.event_id = '00000000-0000-4000-a000-000000000501';

COMMIT;

-- kontrola
SELECT (SELECT COUNT(*) FROM catalog.venue_places WHERE promoter_id = '00000000-0000-4000-a000-000000000002') AS mista,
       (SELECT COUNT(*) FROM catalog.productions WHERE promoter_id = '00000000-0000-4000-a000-000000000002') AS inscenace,
       (SELECT COUNT(*) FROM catalog.events WHERE promoter_id = '00000000-0000-4000-a000-000000000002' AND status = 'published') AS terminy,
       (SELECT COUNT(*) FROM catalog.event_seats es JOIN catalog.events e ON e.id = es.event_id WHERE e.promoter_id = '00000000-0000-4000-a000-000000000002') AS sedadla,
       (SELECT COUNT(*) FROM catalog.price_categories WHERE promoter_id = '00000000-0000-4000-a000-000000000002') AS kategorie,
       (SELECT COUNT(*) FROM catalog.seat_block_seats bs JOIN catalog.seat_blocks b ON b.id = bs.block_id WHERE b.promoter_id = '00000000-0000-4000-a000-000000000002') AS blokovana_mista;
