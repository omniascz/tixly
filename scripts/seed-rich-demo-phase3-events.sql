-- Phase 3a: Eventy + ticket types
BEGIN;

-- ID konvence pro eventy: 00000000-0000-4000-a000-0000000004XX
-- ID konvence pro ticket types: 00000000-0000-4000-a000-0000000005XX
-- POZN. (oprava 2026-06-01): catalog.events.slug je NOT NULL bez defaultu —
-- seed ho dříve nedodával a na čisté DB padal. Doplněno deterministicky (-demo).

-- 1) Romeo a Julie (Stara Strelnice, divadelni hra)
INSERT INTO catalog.events (id, organizer_id, promoter_id, venue_id, slug, title, description, category, event_type, date_start, date_end, sale_start_at, sale_end_at, status, currency, max_tickets_per_order, cover_image_url)
VALUES (
  '00000000-0000-4000-a000-000000000401',
  '00000000-0000-4000-a000-000000000111', '00000000-0000-4000-a000-000000000111',
  'ba5a2248-c11c-42ec-85fe-63929f4d4f3f',
  'romeo-a-julie-demo',
  'Romeo a Julie',
  'Klasicke shakespearovske drama v moderni inscenaci. Reziser: Jan Mikulasek. Ucinkuji: Tatiana Vilhelmova, Vojtech Dyk.',
  'theatre', 'concert',
  '2026-06-15 19:00:00+02', '2026-06-15 21:30:00+02',
  '2026-04-01 00:00:00+02', '2026-06-15 18:00:00+02',
  'published', 'CZK', 8, NULL
) ON CONFLICT (id) DO NOTHING;

-- 2) Hamlet (Stara Strelnice)
INSERT INTO catalog.events (id, organizer_id, promoter_id, venue_id, slug, title, description, category, event_type, date_start, sale_start_at, sale_end_at, status, currency, max_tickets_per_order)
VALUES (
  '00000000-0000-4000-a000-000000000402',
  '00000000-0000-4000-a000-000000000111', '00000000-0000-4000-a000-000000000111',
  'ba5a2248-c11c-42ec-85fe-63929f4d4f3f',
  'hamlet-demo',
  'Hamlet',
  'Hamlet, princ damsky. Tragedie o smrti, pomsteni a sileni. Reziser: Daniel Spinar.',
  'theatre', 'concert',
  '2026-06-22 19:00:00+02', '2026-04-01 00:00:00+02', '2026-06-22 18:00:00+02',
  'published', 'CZK', 8
) ON CONFLICT (id) DO NOTHING;

-- 3) Klasicky koncert (Velky sal)
INSERT INTO catalog.events (id, organizer_id, promoter_id, venue_id, slug, title, description, category, event_type, date_start, sale_start_at, sale_end_at, status, currency, max_tickets_per_order)
VALUES (
  '00000000-0000-4000-a000-000000000403',
  '00000000-0000-4000-a000-000000000112', '00000000-0000-4000-a000-000000000112',
  '00000000-0000-4000-a000-000000000201',
  'symfonicky-koncert-demo',
  'Symfonicky koncert: Dvorak / Smetana',
  'Ceska filharmonie, dirigent Jakub Hrusa. Dvorakova 9. symfonie + Smetanova Vltava.',
  'classical', 'concert',
  '2026-07-10 20:00:00+02', '2026-04-01 00:00:00+02', '2026-07-10 19:00:00+02',
  'published', 'CZK', 6
) ON CONFLICT (id) DO NOTHING;

-- 4) Velky koncert v Arene (mainstream)
INSERT INTO catalog.events (id, organizer_id, promoter_id, venue_id, slug, title, description, category, event_type, date_start, sale_start_at, sale_end_at, status, currency, max_tickets_per_order)
VALUES (
  '00000000-0000-4000-a000-000000000404',
  '00000000-0000-4000-a000-000000000113', '00000000-0000-4000-a000-000000000113',
  '00000000-0000-4000-a000-000000000203',
  'mainstream-tribute-show-demo',
  'Mainstream Tribute Show',
  'Velky tribute koncert v Arene Praha. 17 000 navstevniku. Speciální host: Marek Ztracený.',
  'concert', 'concert',
  '2026-09-15 20:00:00+02', '2026-04-01 00:00:00+02', '2026-09-15 19:00:00+02',
  'published', 'CZK', 8
) ON CONFLICT (id) DO NOTHING;

-- 5) Fotbalove derby (Stadion)
INSERT INTO catalog.events (id, organizer_id, promoter_id, venue_id, slug, title, description, category, event_type, date_start, sale_start_at, sale_end_at, status, currency, max_tickets_per_order, resale_allowed)
VALUES (
  '00000000-0000-4000-a000-000000000405',
  '00000000-0000-4000-a000-000000000113', '00000000-0000-4000-a000-000000000113',
  '00000000-0000-4000-a000-000000000204',
  'fc-praha-sk-brno-derby-demo',
  'FC Praha vs. SK Brno — derby',
  'Top zapas sezony. 50 000 navstevniku. Sektor Sever urcen pouze pro hostujici fanousky.',
  'sport', 'concert',
  '2026-08-30 18:00:00+02', '2026-04-01 00:00:00+02', '2026-08-30 17:00:00+02',
  'published', 'CZK', 4, true
) ON CONFLICT (id) DO NOTHING;

-- 6) Punk festival (Klub Underground — standing)
INSERT INTO catalog.events (id, organizer_id, promoter_id, venue_id, slug, title, description, category, event_type, date_start, sale_start_at, sale_end_at, status, currency, max_tickets_per_order)
VALUES (
  '00000000-0000-4000-a000-000000000406',
  '00000000-0000-4000-a000-000000000114', '00000000-0000-4000-a000-000000000114',
  '00000000-0000-4000-a000-000000000202',
  'punk-underground-night-demo',
  'Punk Underground Night',
  '4 ceske punkove kapely. Bez sedadel, jen standing. Pristup od 18 let.',
  'concert', 'concert',
  '2026-05-20 20:00:00+02', '2026-04-01 00:00:00+02', '2026-05-20 19:30:00+02',
  'published', 'CZK', 4
) ON CONFLICT (id) DO NOTHING;

-- 7) Pending review (jazz night ve Velkem sale)
INSERT INTO catalog.events (id, organizer_id, promoter_id, venue_id, slug, title, description, category, event_type, date_start, sale_start_at, sale_end_at, status, currency, max_tickets_per_order)
VALUES (
  '00000000-0000-4000-a000-000000000407',
  '00000000-0000-4000-a000-000000000112', '00000000-0000-4000-a000-000000000112',
  '00000000-0000-4000-a000-000000000201',
  'jazz-night-sting-tribute-demo',
  'Jazz Night — Sting Tribute',
  'Tribute Stingovi. Zbrusu nova akce, ceka na schvaleni master adminem.',
  'jazz', 'concert',
  '2026-08-05 20:00:00+02', '2026-05-01 00:00:00+02', '2026-08-05 19:00:00+02',
  'pending_review', 'CZK', 6
) ON CONFLICT (id) DO NOTHING;

-- 8) Rejected (akce s podezrelym nazvem)
INSERT INTO catalog.events (id, organizer_id, promoter_id, venue_id, slug, title, description, category, event_type, date_start, sale_start_at, sale_end_at, status, currency, max_tickets_per_order)
VALUES (
  '00000000-0000-4000-a000-000000000408',
  '00000000-0000-4000-a000-000000000114', '00000000-0000-4000-a000-000000000114',
  '00000000-0000-4000-a000-000000000202',
  'investicni-prilezitost-demo',
  'Investicni prilezitost — 100% guarantee',
  'Akce s podezrelym scam patternem. Zamitnuta automaticky.',
  'other', 'concert',
  '2026-09-01 19:00:00+02', '2026-05-01 00:00:00+02', '2026-09-01 18:00:00+02',
  'rejected', 'CZK', 4
) ON CONFLICT (id) DO NOTHING;

-- 9) Free workshop (Klub Underground)
INSERT INTO catalog.events (id, organizer_id, promoter_id, venue_id, slug, title, description, category, event_type, date_start, sale_start_at, sale_end_at, status, currency, max_tickets_per_order)
VALUES (
  '00000000-0000-4000-a000-000000000409',
  '00000000-0000-4000-a000-000000000114', '00000000-0000-4000-a000-000000000114',
  '00000000-0000-4000-a000-000000000202',
  'workshop-kytarove-improvizace-demo',
  'Workshop kytarove improvizace (zdarma)',
  'Worskhop pro zacinajici hudebniky. Vstup zdarma, registrace povinna.',
  'workshop', 'concert',
  '2026-05-05 18:00:00+02', '2026-04-01 00:00:00+02', '2026-05-05 17:00:00+02',
  'published', 'CZK', 1
) ON CONFLICT (id) DO NOTHING;

-- 10) Akce v minulosti (Stara Strelnice, sold out)
INSERT INTO catalog.events (id, organizer_id, promoter_id, venue_id, slug, title, description, category, event_type, date_start, sale_start_at, sale_end_at, status, currency, max_tickets_per_order)
VALUES (
  '00000000-0000-4000-a000-000000000410',
  '00000000-0000-4000-a000-000000000111', '00000000-0000-4000-a000-000000000111',
  'ba5a2248-c11c-42ec-85fe-63929f4d4f3f',
  'strindberg-tanec-smrti-demo',
  'Strindberg — Tanec smrti (proběhlo)',
  'Akce probehla pred 6 tydny. Prodeje uzavreny.',
  'theatre', 'concert',
  '2026-03-15 19:00:00+02', '2026-01-15 00:00:00+02', '2026-03-15 18:00:00+02',
  'published', 'CZK', 8
) ON CONFLICT (id) DO NOTHING;

-- ===== Ticket Types =====

-- Romeo a Julie: 3 cenove kategorie podle sektoru
INSERT INTO catalog.ticket_types (id, event_id, name, kind, base_price, total_qty, remaining_qty, max_per_user, zone, is_seated, attendance_type)
VALUES
  ('00000000-0000-4000-a000-000000000501', '00000000-0000-4000-a000-000000000401', 'PRIZEMI A (radove sedadlo, dospely)', 'seated', 35000, 215, 215, 4, 'PRIZEMI', true, 'physical'),
  ('00000000-0000-4000-a000-000000000502', '00000000-0000-4000-a000-000000000401', 'BALKON',                                  'seated', 28000, 60,  60,  4, 'BALKON',  true, 'physical'),
  ('00000000-0000-4000-a000-000000000503', '00000000-0000-4000-a000-000000000401', 'GALERIE',                                'seated', 18000, 33,  33,  4, 'GALERIE', true, 'physical')
ON CONFLICT (id) DO NOTHING;

-- Hamlet: stejna struktura
INSERT INTO catalog.ticket_types (id, event_id, name, kind, base_price, total_qty, remaining_qty, max_per_user, zone, is_seated, attendance_type)
VALUES
  ('00000000-0000-4000-a000-000000000504', '00000000-0000-4000-a000-000000000402', 'PRIZEMI', 'seated', 35000, 215, 215, 4, 'PRIZEMI', true, 'physical'),
  ('00000000-0000-4000-a000-000000000505', '00000000-0000-4000-a000-000000000402', 'BALKON',  'seated', 28000, 60,  60,  4, 'BALKON',  true, 'physical'),
  ('00000000-0000-4000-a000-000000000506', '00000000-0000-4000-a000-000000000402', 'GALERIE', 'seated', 18000, 33,  33,  4, 'GALERIE', true, 'physical')
ON CONFLICT (id) DO NOTHING;

-- Symfonicky koncert (Velky sal): VIP / Parter / Balkon / Loze / Galerie
INSERT INTO catalog.ticket_types (id, event_id, name, kind, base_price, total_qty, remaining_qty, max_per_user, zone, is_seated, attendance_type)
VALUES
  ('00000000-0000-4000-a000-000000000510', '00000000-0000-4000-a000-000000000403', 'VIP Loze',           'seated', 250000, 100, 100, 4, 'LOZE',           true, 'physical'),
  ('00000000-0000-4000-a000-000000000511', '00000000-0000-4000-a000-000000000403', 'Parter A (1.-10. rada)', 'seated', 180000, 280, 280, 4, 'PARTER',         true, 'physical'),
  ('00000000-0000-4000-a000-000000000512', '00000000-0000-4000-a000-000000000403', 'Parter B (11.-25. rada)','seated', 120000, 420, 420, 6, 'PARTER',         true, 'physical'),
  ('00000000-0000-4000-a000-000000000513', '00000000-0000-4000-a000-000000000403', 'Balkon Stredni',     'seated', 80000,  300, 300, 6, 'BALKON STREDNI', true, 'physical'),
  ('00000000-0000-4000-a000-000000000514', '00000000-0000-4000-a000-000000000403', 'Balkon Bocni',       'seated', 60000,  400, 400, 6, 'BALKON',         true, 'physical')
ON CONFLICT (id) DO NOTHING;

-- Mainstream Arena: parter standing + lower bowl + upper bowl + VIP boxy
INSERT INTO catalog.ticket_types (id, event_id, name, kind, base_price, total_qty, remaining_qty, max_per_user, zone, is_seated, attendance_type)
VALUES
  ('00000000-0000-4000-a000-000000000520', '00000000-0000-4000-a000-000000000404', 'Parter (standing)',  'seated', 250000, 3000, 600,  6, 'PARTER', true, 'physical'),
  ('00000000-0000-4000-a000-000000000521', '00000000-0000-4000-a000-000000000404', 'Lower Bowl 100s',     'seated', 180000, 6000, 1500, 6, 'LB',     true, 'physical'),
  ('00000000-0000-4000-a000-000000000522', '00000000-0000-4000-a000-000000000404', 'Upper Bowl 200s',     'seated', 120000, 6960, 2000, 8, 'UB',     true, 'physical'),
  ('00000000-0000-4000-a000-000000000523', '00000000-0000-4000-a000-000000000404', 'VIP Box (12 mist)',   'seated', 1000000, 960, 360,  12, 'BOX',   true, 'physical')
ON CONFLICT (id) DO NOTHING;

-- Derby: 4 tribuny
INSERT INTO catalog.ticket_types (id, event_id, name, kind, base_price, total_qty, remaining_qty, max_per_user, zone, is_seated, attendance_type)
VALUES
  ('00000000-0000-4000-a000-000000000530', '00000000-0000-4000-a000-000000000405', 'Vychod (hlavni tribuna VIP)', 'seated', 200000, 12500, 0, 4, 'VYCHOD', true, 'physical'),
  ('00000000-0000-4000-a000-000000000531', '00000000-0000-4000-a000-000000000405', 'Zapad (klasicka tribuna)',     'seated', 80000,  12500, 0, 4, 'ZAPAD',  true, 'physical'),
  ('00000000-0000-4000-a000-000000000532', '00000000-0000-4000-a000-000000000405', 'Jih (rodinny sektor)',         'seated', 60000,  12500, 0, 4, 'JIH',    true, 'physical'),
  ('00000000-0000-4000-a000-000000000533', '00000000-0000-4000-a000-000000000405', 'Sever (pouze hostujici fanousci)','seated', 60000, 12500, 0, 4, 'SEVER',  true, 'physical')
ON CONFLICT (id) DO NOTHING;

-- Punk Festival (standing only)
INSERT INTO catalog.ticket_types (id, event_id, name, kind, base_price, total_qty, remaining_qty, max_per_user, zone, is_seated, attendance_type)
VALUES
  ('00000000-0000-4000-a000-000000000540', '00000000-0000-4000-a000-000000000406', 'Standing presale',  'standing', 35000, 100, 50, 2, NULL, false, 'physical'),
  ('00000000-0000-4000-a000-000000000541', '00000000-0000-4000-a000-000000000406', 'Standing on door',  'standing', 45000, 100, 80, 2, NULL, false, 'physical')
ON CONFLICT (id) DO NOTHING;

-- Jazz pending review (zatim 1 typ)
INSERT INTO catalog.ticket_types (id, event_id, name, kind, base_price, total_qty, remaining_qty, max_per_user, zone, is_seated, attendance_type)
VALUES
  ('00000000-0000-4000-a000-000000000550', '00000000-0000-4000-a000-000000000407', 'Jazz Standard', 'seated', 75000, 1500, 1500, 6, NULL, true, 'physical')
ON CONFLICT (id) DO NOTHING;

-- Free workshop
INSERT INTO catalog.ticket_types (id, event_id, name, kind, base_price, total_qty, remaining_qty, max_per_user, zone, is_seated, attendance_type)
VALUES
  ('00000000-0000-4000-a000-000000000560', '00000000-0000-4000-a000-000000000409', 'Workshop (zdarma)', 'standing', 0, 30, 25, 1, NULL, false, 'physical')
ON CONFLICT (id) DO NOTHING;

-- Strindberg minulost (sold out)
INSERT INTO catalog.ticket_types (id, event_id, name, kind, base_price, total_qty, remaining_qty, max_per_user, zone, is_seated, attendance_type)
VALUES
  ('00000000-0000-4000-a000-000000000570', '00000000-0000-4000-a000-000000000410', 'PRIZEMI', 'seated', 30000, 215, 0, 4, 'PRIZEMI', true, 'physical'),
  ('00000000-0000-4000-a000-000000000571', '00000000-0000-4000-a000-000000000410', 'BALKON',  'seated', 22000, 93,  0, 4, 'BALKON',  true, 'physical')
ON CONFLICT (id) DO NOTHING;

-- Update min_age pro punk a investicni
UPDATE catalog.events SET min_age = 18 WHERE id = '00000000-0000-4000-a000-000000000406';

COMMIT;

SELECT e.id, e.title, v.name as venue, e.status, e.date_start::date, COUNT(tt.id) as types
FROM catalog.events e
JOIN catalog.venues v ON v.id = e.venue_id
LEFT JOIN catalog.ticket_types tt ON tt.event_id = e.id
WHERE e.id::text LIKE '00000000-0000-4000-a000-0000000004%'
GROUP BY e.id, e.title, v.name, e.status, e.date_start
ORDER BY e.date_start;
