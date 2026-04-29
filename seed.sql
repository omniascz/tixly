-- =============================================================================
-- TICKETING PLATFORM — SEED DATA
-- Vygenerováno: 2026-04-03
-- Obsahuje: 500 uživatelů, 5 venues, 10 akcí, 300 objednávek, 600 vstupenek
-- =============================================================================

BEGIN;

-- =============================================================================
-- === VENUES (5 míst konání) ===
-- =============================================================================

INSERT INTO catalog.venues (id, name, address, city, country, capacity, seat_map_json) VALUES
-- 1. O2 Arena Praha — 18000 míst, seated
('a0000000-0000-0000-0000-000000000001', 'O2 Arena Praha', 'Pobřežní 3, 186 00 Praha 8', 'Praha', 'CZ', 18000,
'{
  "sections": {
    "Floor": {"rows": 3, "seats_per_row": 20, "price_zone": "floor"},
    "Tribuna A": {"rows": 3, "seats_per_row": 20, "price_zone": "tribune"},
    "Tribuna B": {"rows": 3, "seats_per_row": 20, "price_zone": "tribune"}
  }
}'::jsonb),

-- 2. Klub Světozor Praha — 300 míst, standing
('a0000000-0000-0000-0000-000000000002', 'Klub Světozor Praha', 'Vodičkova 39, 110 00 Praha 1', 'Praha', 'CZ', 300, NULL),

-- 3. Divadlo Na Vinohradech Praha — 520 míst, seated
('a0000000-0000-0000-0000-000000000003', 'Divadlo Na Vinohradech Praha', 'Nám. Míru 7, 120 00 Praha 2', 'Praha', 'CZ', 520,
'{
  "sections": {
    "Přízemí": {"rows": 5, "seats_per_row": 12, "price_zone": "orchestra"},
    "1. balkón": {"rows": 5, "seats_per_row": 12, "price_zone": "balcony"},
    "2. balkón": {"rows": 5, "seats_per_row": 12, "price_zone": "balcony"}
  }
}'::jsonb),

-- 4. Beats Klub Brno — 800 míst, mix
('a0000000-0000-0000-0000-000000000004', 'Beats Klub Brno', 'Kounicova 33, 602 00 Brno', 'Brno', 'CZ', 800,
'{
  "sections": {
    "Dancefloor": {"rows": 1, "seats_per_row": 400, "price_zone": "standing"},
    "VIP lounge": {"rows": 2, "seats_per_row": 100, "price_zone": "vip"}
  }
}'::jsonb),

-- 5. Letní scéna Výstaviště Praha — 5000 míst, standing + VIP seated
('a0000000-0000-0000-0000-000000000005', 'Letní scéna Výstaviště Praha', 'Výstaviště 1, 130 00 Praha 3', 'Praha', 'CZ', 5000,
'{
  "sections": {
    "General area": {"rows": 1, "seats_per_row": 4700, "price_zone": "standing"},
    "VIP seated": {"rows": 3, "seats_per_row": 100, "price_zone": "vip"}
  }
}'::jsonb);

-- =============================================================================
-- === USERS (500 uživatelů s českými jmény) ===
-- =============================================================================

INSERT INTO identity.users
(id, email, phone, name, password_hash, email_verified_at, phone_verified_at, gdpr_consent_at, deleted_at) VALUES

-- Fixní UUID pro prvního uživatele (testování)
('f47ac10b-58cc-4372-a567-0e02b2c3d479', 'jan.novak@gmail.com', '+420720123456', 'Jan Nováka',
 '$2b$12$R9h7cIPz0gi.URNNX3kh2OPST9EBV4YXyQg4Q5zH7Qzb/R6Y1YvG2',
 NOW() - INTERVAL '60 days', NOW() - INTERVAL '55 days', NOW() - INTERVAL '70 days', NULL),

-- Uživatelé bez phone_verified (pro testování edge cases) — 5 uživatelů
('a1111111-1111-1111-1111-111111111111', 'petra.svobodova@seznam.cz', '+420731234567', 'Petra Svobodová',
 '$2b$12$R9h7cIPz0gi.URNNX3kh2OPST9EBV4YXyQg4Q5zH7Qzb/R6Y1YvG2',
 NOW() - INTERVAL '45 days', NULL, NOW() - INTERVAL '50 days', NULL),

('a2222222-2222-2222-2222-222222222222', 'david.cerny@email.cz', '+420741234567', 'David Černý',
 '$2b$12$R9h7cIPz0gi.URNNX3kh2OPST9EBV4YXyQg4Q5zH7Qzb/R6Y1YvG2',
 NOW() - INTERVAL '30 days', NULL, NOW() - INTERVAL '35 days', NULL),

('a3333333-3333-3333-3333-333333333333', 'katerina.zuzulova@gmail.com', '+420751234567', 'Kateřina Zuzulová',
 '$2b$12$R9h7cIPz0gi.URNNX3kh2OPST9EBV4YXyQg4Q5zH7Qzb/R6Y1YvG2',
 NOW() - INTERVAL '25 days', NULL, NOW() - INTERVAL '30 days', NULL),

('a4444444-4444-4444-4444-444444444444', 'martin.horvath@gmail.com', '+420761234567', 'Martin Horváth',
 '$2b$12$R9h7cIPz0gi.URNNX3kh2OPST9EBV4YXyQg4Q5zH7Qzb/R6Y1YvG2',
 NOW() - INTERVAL '20 days', NULL, NOW() - INTERVAL '25 days', NULL),

('a5555555-5555-5555-5555-555555555555', 'miriam.pavelkova@seznam.cz', '+420771234567', 'Miriam Pavelková',
 '$2b$12$R9h7cIPz0gi.URNNX3kh2OPST9EBV4YXyQg4Q5zH7Qzb/R6Y1YvG2',
 NOW() - INTERVAL '15 days', NULL, NOW() - INTERVAL '20 days', NULL);

-- Dalších 495 uživatelů — mix verifikovaných a soft deleted
INSERT INTO identity.users
(id, email, phone, name, password_hash, email_verified_at, phone_verified_at, gdpr_consent_at, deleted_at)
SELECT
  gen_random_uuid() AS id,
  'user' || seq || '@testdomain.cz' AS email,
  CASE WHEN seq % 5 = 0 THEN NULL ELSE '+420' || (720000000 + seq) END AS phone,
  CASE
    WHEN seq % 12 = 0 THEN 'Adam Kovács'
    WHEN seq % 12 = 1 THEN 'Barbara Nováková'
    WHEN seq % 12 = 2 THEN 'Cyprián Bednář'
    WHEN seq % 12 = 3 THEN 'Dana Svobodová'
    WHEN seq % 12 = 4 THEN 'Eduard Petřín'
    WHEN seq % 12 = 5 THEN 'Eva Králová'
    WHEN seq % 12 = 6 THEN 'František Dostál'
    WHEN seq % 12 = 7 THEN 'Gabriela Havlíková'
    WHEN seq % 12 = 8 THEN 'Helena Černovská'
    WHEN seq % 12 = 9 THEN 'Ivan Procházka'
    WHEN seq % 12 = 10 THEN 'Jitka Maršálková'
    ELSE 'Klara Urbánková'
  END AS name,
  '$2b$12$R9h7cIPz0gi.URNNX3kh2OPST9EBV4YXyQg4Q5zH7Qzb/R6Y1YvG2' AS password_hash,
  CASE WHEN seq % 100 < 60 THEN NOW() - INTERVAL '1 day' * (1 + (seq % 60)) ELSE NULL END AS email_verified_at,
  CASE WHEN seq % 100 < 80 THEN NOW() - INTERVAL '1 day' * (1 + (seq % 80)) ELSE NULL END AS phone_verified_at,
  NOW() - INTERVAL '1 day' * (1 + (seq % 60)) AS gdpr_consent_at,
  CASE WHEN seq % 100 < 10 THEN NOW() - INTERVAL '1 day' * (1 + (seq % 10)) ELSE NULL END AS deleted_at
FROM generate_series(6, 500) AS seq;

-- =============================================================================
-- === USER DEVICES (50 devices) ===
-- =============================================================================

INSERT INTO identity.user_devices (user_id, device_fingerprint_hash, device_type)
SELECT
  (ARRAY(SELECT id FROM identity.users LIMIT 500))[1 + (seq % 500)] AS user_id,
  'device_hash_' || seq::text AS device_fingerprint_hash,
  CASE WHEN seq % 4 = 0 THEN 'web' WHEN seq % 4 = 1 THEN 'ios' WHEN seq % 4 = 2 THEN 'android' ELSE 'other' END AS device_type
FROM generate_series(1, 50) AS seq;

-- =============================================================================
-- === REFRESH TOKENS (200 tokenů — mix aktivních, expirovaných, revokovaných) ===
-- =============================================================================

INSERT INTO identity.refresh_tokens (user_id, device_id, token_hash, family_id, expires_at, used_at, revoked_at)
SELECT
  u.id,
  d.id,
  'token_hash_' || seq::text,
  gen_random_uuid(),
  CASE
    WHEN seq % 10 = 0 THEN NOW() - INTERVAL '10 days'
    WHEN seq % 10 = 1 THEN NOW() + INTERVAL '30 days'
    ELSE NOW() + INTERVAL '7 days'
  END AS expires_at,
  CASE WHEN seq % 15 = 0 THEN NOW() - INTERVAL '2 days' ELSE NULL END AS used_at,
  CASE WHEN seq % 20 = 0 THEN NOW() - INTERVAL '5 days' ELSE NULL END AS revoked_at
FROM (
  SELECT (ARRAY(SELECT id FROM identity.users LIMIT 500))[1 + ((seq - 1) % 500)] AS id FROM generate_series(1, 200) AS seq
) u
CROSS JOIN (
  SELECT id FROM identity.user_devices LIMIT 1
) d
CROSS JOIN LATERAL (SELECT seq) _;

-- =============================================================================
-- === EVENTS (10 akcí — různé kategorie, stavy, ceny) ===
-- =============================================================================

INSERT INTO catalog.events
(id, organizer_id, venue_id, title, description, category, date_start, date_end, status, sale_start_at, sale_end_at, resale_allowed) VALUES

-- 1. Imagine Dragons — O2 Arena, minulý týden na sale, populární
('e0000000-0000-0000-0000-000000000001', 'f47ac10b-58cc-4372-a567-0e02b2c3d479', 'a0000000-0000-0000-0000-000000000001',
 'Imagine Dragons — Mercury World Tour', 'Legendární kapela Imagine Dragons se vrací do Prahy s novým turné.',
 'music', NOW() + INTERVAL '73 days', NOW() + INTERVAL '74 days', 'published',
 NOW() - INTERVAL '7 days', NOW() + INTERVAL '50 days', TRUE),

-- 2. Jazz večer — Světozor, brzy
('e0000000-0000-0000-0000-000000000002', 'f47ac10b-58cc-4372-a567-0e02b2c3d479', 'a0000000-0000-0000-0000-000000000002',
 'Jazz večer s Jiřím Kohákem', 'Intimní večer s jazzovými standardy na nejmenší scéně Prahy.',
 'music', NOW() + INTERVAL '47 days', NOW() + INTERVAL '47 days', 'published',
 NOW() - INTERVAL '2 days', NOW() + INTERVAL '40 days', TRUE),

-- 3. Hamlet — Divadlo Na Vinohradech, brzy
('e0000000-0000-0000-0000-000000000003', 'f47ac10b-58cc-4372-a567-0e02b2c3d479', 'a0000000-0000-0000-0000-000000000003',
 'Hamlet — Shakespearův klasik', 'Tradiční divadelní inscenace nejslavnější Shakespearovy tragédie.',
 'theater', NOW() + INTERVAL '35 days', NOW() + INTERVAL '35 days', 'published',
 NOW() - INTERVAL '30 days', NOW() + INTERVAL '30 days', TRUE),

-- 4. Techno Night — Beats Klub Brno, za měsíc
('e0000000-0000-0000-0000-000000000004', 'f47ac10b-58cc-4372-a567-0e02b2c3d479', 'a0000000-0000-0000-0000-000000000004',
 'Techno Night Brno', 'Noční tanec s nejlepšími DJ z Evropy. Festival elektronické hudby.',
 'music', NOW() + INTERVAL '28 days', NOW() + INTERVAL '29 days', 'published',
 NOW() - INTERVAL '5 days', NOW() + INTERVAL '20 days', TRUE),

-- 5. Letní festival Praha — Výstaviště, červenec
('e0000000-0000-0000-0000-000000000005', 'f47ac10b-58cc-4372-a567-0e02b2c3d479', 'a0000000-0000-0000-0000-000000000005',
 'Letní festival Praha 2026', 'Třídenní festival s nejpopulárnějšími kapelami. Camping, jídlo, skvělá atmosféra.',
 'music', NOW() + INTERVAL '92 days', NOW() + INTERVAL '94 days', 'published',
 NOW(), NOW() + INTERVAL '80 days', TRUE),

-- 6. Stand-up Comedy — Světozor, za 3 týdny
('e0000000-0000-0000-0000-000000000006', 'f47ac10b-58cc-4372-a567-0e02b2c3d479', 'a0000000-0000-0000-0000-000000000002',
 'Stand-up Comedy Night', 'Zábavný program s hvězdami české stand-up scény.',
 'comedy', NOW() + INTERVAL '22 days', NOW() + INTERVAL '22 days', 'published',
 NOW() - INTERVAL '10 days', NOW() + INTERVAL '15 days', TRUE),

-- 7. Klasický koncert — Divadlo Na Vinohradech, konec dubna
('e0000000-0000-0000-0000-000000000007', 'f47ac10b-58cc-4372-a567-0e02b2c3d479', 'a0000000-0000-0000-0000-000000000003',
 'Koncert České filharmonie', 'Koncert se Symfonií č. 9 Ludvíka van Beethovena.',
 'classical', NOW() + INTERVAL '27 days', NOW() + INTERVAL '27 days', 'published',
 NOW() - INTERVAL '20 days', NOW() + INTERVAL '20 days', TRUE),

-- 8. EDM Party — Beats Klub Brno, draft (nepublikováno)
('e0000000-0000-0000-0000-000000000008', 'f47ac10b-58cc-4372-a567-0e02b2c3d479', 'a0000000-0000-0000-0000-000000000004',
 'Experimental EDM Party', 'Předpokládaná akce — zarezervované místo, ještě nejsou lístky v prodeji.',
 'music', NOW() + INTERVAL '37 days', NOW() + INTERVAL '38 days', 'draft',
 NULL, NULL, TRUE),

-- 9. Unplugged Session — Světozor, květen
('e0000000-0000-0000-0000-000000000009', 'f47ac10b-58cc-4372-a567-0e02b2c3d479', 'a0000000-0000-0000-0000-000000000002',
 'Unplugged Session — Local Artists', 'Akustická show domácích interpretů.',
 'music', NOW() + INTERVAL '45 days', NOW() + INTERVAL '45 days', 'published',
 NOW() - INTERVAL '3 days', NOW() + INTERVAL '35 days', TRUE),

-- 10. Dětský den — Výstaviště, červen, resale_allowed=false
('e0000000-0000-0000-0000-000000000010', 'f47ac10b-58cc-4372-a567-0e02b2c3d479', 'a0000000-0000-0000-0000-000000000005',
 'Dětský den na Výstavišti', 'Zábavné aktivity pro děti, skákací hrady, soutěže a ceny.',
 'family', NOW() + INTERVAL '59 days', NOW() + INTERVAL '59 days', 'published',
 NOW() - INTERVAL '15 days', NOW() + INTERVAL '45 days', FALSE);

-- =============================================================================
-- === TICKET TYPES (2–4 typy na akci, celkem ~26 typů) ===
-- =============================================================================

-- Imagine Dragons (4 typy)
INSERT INTO catalog.ticket_types
(event_id, name, kind, base_price, total_qty, remaining_qty, max_per_user, zone) VALUES
('e0000000-0000-0000-0000-000000000001', 'General Standing', 'standing', 890.00, 10000, 7200, 4, NULL),
('e0000000-0000-0000-0000-000000000001', 'VIP Seated', 'seated', 2490.00, 1000, 650, 2, 'VIP'),
('e0000000-0000-0000-0000-000000000001', 'Standard Seated', 'seated', 1490.00, 3000, 1900, 3, 'Standard'),
('e0000000-0000-0000-0000-000000000001', 'Economy Seated', 'seated', 890.00, 4000, 2400, 3, 'Economy');

-- Jazz večer (2 typy)
INSERT INTO catalog.ticket_types (event_id, name, kind, base_price, total_qty, remaining_qty, max_per_user) VALUES
('e0000000-0000-0000-0000-000000000002', 'General Admission', 'standing', 250.00, 300, 200, 2),
('e0000000-0000-0000-0000-000000000002', 'VIP Table', 'standing', 650.00, 30, 25, 2);

-- Hamlet (3 typy)
INSERT INTO catalog.ticket_types (event_id, name, kind, base_price, total_qty, remaining_qty, max_per_user, zone) VALUES
('e0000000-0000-0000-0000-000000000003', 'Parterre', 'seated', 450.00, 200, 120, 2, 'Přízemí'),
('e0000000-0000-0000-0000-000000000003', '1. balkón', 'seated', 350.00, 160, 100, 2, '1. balkón'),
('e0000000-0000-0000-0000-000000000003', '2. balkón', 'seated', 250.00, 160, 110, 2, '2. balkón');

-- Techno Night Brno (2 typy)
INSERT INTO catalog.ticket_types (event_id, name, kind, base_price, total_qty, remaining_qty, max_per_user) VALUES
('e0000000-0000-0000-0000-000000000004', 'General Admission', 'standing', 450.00, 600, 380, 2),
('e0000000-0000-0000-0000-000000000004', 'VIP Lounge', 'standing', 1200.00, 200, 130, 1);

-- Letní festival Praha (3 typy)
INSERT INTO catalog.ticket_types (event_id, name, kind, base_price, total_qty, remaining_qty, max_per_user) VALUES
('e0000000-0000-0000-0000-000000000005', 'Day Pass', 'standing', 650.00, 2000, 1200, 1),
('e0000000-0000-0000-0000-000000000005', 'Weekend Pass', 'standing', 1500.00, 1500, 900, 1),
('e0000000-0000-0000-0000-000000000005', 'VIP Weekend', 'standing', 3500.00, 200, 140, 1);

-- Stand-up Comedy (2 typy)
INSERT INTO catalog.ticket_types (event_id, name, kind, base_price, total_qty, remaining_qty, max_per_user) VALUES
('e0000000-0000-0000-0000-000000000006', 'Standard', 'standing', 300.00, 300, 180, 2),
('e0000000-0000-0000-0000-000000000006', 'VIP Front Row', 'standing', 650.00, 50, 35, 2);

-- Koncert ČF (3 typy)
INSERT INTO catalog.ticket_types (event_id, name, kind, base_price, total_qty, remaining_qty, max_per_user, zone) VALUES
('e0000000-0000-0000-0000-000000000007', 'Parterre Economy', 'seated', 400.00, 150, 90, 2, 'Přízemí'),
('e0000000-0000-0000-0000-000000000007', 'Parterre Standard', 'seated', 650.00, 100, 65, 2, 'Přízemí'),
('e0000000-0000-0000-0000-000000000007', 'Balcony VIP', 'seated', 850.00, 200, 150, 2, '1. balkón');

-- EDM Party draft (2 typy)
INSERT INTO catalog.ticket_types (event_id, name, kind, base_price, total_qty, remaining_qty, max_per_user) VALUES
('e0000000-0000-0000-0000-000000000008', 'General Admission', 'standing', 380.00, 700, 500, 3),
('e0000000-0000-0000-0000-000000000008', 'VIP Pass', 'standing', 950.00, 100, 70, 1);

-- Unplugged Session (2 typy)
INSERT INTO catalog.ticket_types (event_id, name, kind, base_price, total_qty, remaining_qty, max_per_user) VALUES
('e0000000-0000-0000-0000-000000000009', 'General Admission', 'standing', 200.00, 300, 180, 2),
('e0000000-0000-0000-0000-000000000009', 'VIP Lounge', 'standing', 550.00, 50, 30, 1);

-- Dětský den (2 typy)
INSERT INTO catalog.ticket_types (event_id, name, kind, base_price, total_qty, remaining_qty, max_per_user) VALUES
('e0000000-0000-0000-0000-000000000010', 'Child (3-14)', 'standing', 150.00, 1500, 900, 5),
('e0000000-0000-0000-0000-000000000010', 'Adult', 'standing', 250.00, 3500, 2100, 5);

-- =============================================================================
-- === PRICING RULES (3–4 fáze na ticket type) ===
-- =============================================================================

-- Imagine Dragons — General Standing (4 fáze)
INSERT INTO catalog.pricing_rules
(ticket_type_id, phase, price, threshold_qty, threshold_date, demand_factor_min, demand_factor_max, priority, active)
SELECT
  id, 'early_bird', 620.00, NULL, NOW() + INTERVAL '58 days', 1.0, 1.0, 10, TRUE
FROM catalog.ticket_types WHERE event_id = 'e0000000-0000-0000-0000-000000000001' AND name = 'General Standing';

INSERT INTO catalog.pricing_rules (ticket_type_id, phase, price, threshold_date, demand_factor_min, demand_factor_max, priority, active)
SELECT id, 'regular', 890.00, NOW() + INTERVAL '43 days', 1.0, 1.3, 20, TRUE
FROM catalog.ticket_types WHERE event_id = 'e0000000-0000-0000-0000-000000000001' AND name = 'General Standing';

INSERT INTO catalog.pricing_rules (ticket_type_id, phase, price, threshold_qty, demand_factor_min, demand_factor_max, priority, active)
SELECT id, 'late', 1070.00, 1000, 1.0, 1.3, 30, TRUE
FROM catalog.ticket_types WHERE event_id = 'e0000000-0000-0000-0000-000000000001' AND name = 'General Standing';

INSERT INTO catalog.pricing_rules (ticket_type_id, phase, price, threshold_date, demand_factor_min, demand_factor_max, priority, active)
SELECT id, 'door', 1290.00, NOW() + INTERVAL '73 days', 1.0, 1.0, 40, TRUE
FROM catalog.ticket_types WHERE event_id = 'e0000000-0000-0000-0000-000000000001' AND name = 'General Standing';

-- Imagine Dragons — VIP Seated (3 fáze)
INSERT INTO catalog.pricing_rules (ticket_type_id, phase, price, threshold_date, demand_factor_min, demand_factor_max, priority, active)
SELECT id, 'early_bird', 1740.00, NOW() + INTERVAL '58 days', 1.0, 1.0, 10, TRUE
FROM catalog.ticket_types WHERE event_id = 'e0000000-0000-0000-0000-000000000001' AND name = 'VIP Seated';

INSERT INTO catalog.pricing_rules (ticket_type_id, phase, price, threshold_date, demand_factor_min, demand_factor_max, priority, active)
SELECT id, 'regular', 2490.00, NOW() + INTERVAL '43 days', 1.0, 1.2, 20, TRUE
FROM catalog.ticket_types WHERE event_id = 'e0000000-0000-0000-0000-000000000001' AND name = 'VIP Seated';

INSERT INTO catalog.pricing_rules (ticket_type_id, phase, price, demand_factor_min, demand_factor_max, priority, active)
SELECT id, 'late', 2990.00, 1.0, 1.2, 30, TRUE
FROM catalog.ticket_types WHERE event_id = 'e0000000-0000-0000-0000-000000000001' AND name = 'VIP Seated';

-- Jazz večer — General Admission (3 fáze)
INSERT INTO catalog.pricing_rules (ticket_type_id, phase, price, threshold_date, demand_factor_min, demand_factor_max, priority, active)
SELECT id, 'early_bird', 200.00, NOW() + INTERVAL '35 days', 1.0, 1.0, 10, TRUE
FROM catalog.ticket_types WHERE event_id = 'e0000000-0000-0000-0000-000000000002' AND name = 'General Admission';

INSERT INTO catalog.pricing_rules (ticket_type_id, phase, price, threshold_date, demand_factor_min, demand_factor_max, priority, active)
SELECT id, 'regular', 250.00, NOW() + INTERVAL '30 days', 1.0, 1.1, 20, TRUE
FROM catalog.ticket_types WHERE event_id = 'e0000000-0000-0000-0000-000000000002' AND name = 'General Admission';

INSERT INTO catalog.pricing_rules (ticket_type_id, phase, price, threshold_qty, demand_factor_min, demand_factor_max, priority, active)
SELECT id, 'late', 300.00, 60, 1.0, 1.0, 30, TRUE
FROM catalog.ticket_types WHERE event_id = 'e0000000-0000-0000-0000-000000000002' AND name = 'General Admission';

-- Hamlet — Parterre (3 fáze)
INSERT INTO catalog.pricing_rules (ticket_type_id, phase, price, threshold_date, demand_factor_min, demand_factor_max, priority, active)
SELECT id, 'early_bird', 350.00, NOW() + INTERVAL '5 days', 1.0, 1.0, 10, TRUE
FROM catalog.ticket_types WHERE event_id = 'e0000000-0000-0000-0000-000000000003' AND name = 'Parterre';

INSERT INTO catalog.pricing_rules (ticket_type_id, phase, price, threshold_date, demand_factor_min, demand_factor_max, priority, active)
SELECT id, 'regular', 450.00, NOW() + INTERVAL '0 days', 1.0, 1.1, 20, TRUE
FROM catalog.ticket_types WHERE event_id = 'e0000000-0000-0000-0000-000000000003' AND name = 'Parterre';

INSERT INTO catalog.pricing_rules (ticket_type_id, phase, price, threshold_qty, demand_factor_min, demand_factor_max, priority, active)
SELECT id, 'late', 540.00, 40, 1.0, 1.0, 30, TRUE
FROM catalog.ticket_types WHERE event_id = 'e0000000-0000-0000-0000-000000000003' AND name = 'Parterre';

-- Techno Night — General Admission (3 fáze)
INSERT INTO catalog.pricing_rules (ticket_type_id, phase, price, threshold_date, demand_factor_min, demand_factor_max, priority, active)
SELECT id, 'early_bird', 350.00, NOW() + INTERVAL '18 days', 1.0, 1.0, 10, TRUE
FROM catalog.ticket_types WHERE event_id = 'e0000000-0000-0000-0000-000000000004' AND name = 'General Admission';

INSERT INTO catalog.pricing_rules (ticket_type_id, phase, price, threshold_date, demand_factor_min, demand_factor_max, priority, active)
SELECT id, 'regular', 450.00, NOW() + INTERVAL '-2 days', 1.0, 1.2, 20, TRUE
FROM catalog.ticket_types WHERE event_id = 'e0000000-0000-0000-0000-000000000004' AND name = 'General Admission';

INSERT INTO catalog.pricing_rules (ticket_type_id, phase, price, threshold_qty, demand_factor_min, demand_factor_max, priority, active)
SELECT id, 'late', 540.00, 180, 1.0, 1.0, 30, TRUE
FROM catalog.ticket_types WHERE event_id = 'e0000000-0000-0000-0000-000000000004' AND name = 'General Admission';

-- Letní festival — Day Pass (3 fáze)
INSERT INTO catalog.pricing_rules (ticket_type_id, phase, price, threshold_date, demand_factor_min, demand_factor_max, priority, active)
SELECT id, 'early_bird', 500.00, NOW() + INTERVAL '70 days', 1.0, 1.0, 10, TRUE
FROM catalog.ticket_types WHERE event_id = 'e0000000-0000-0000-0000-000000000005' AND name = 'Day Pass';

INSERT INTO catalog.pricing_rules (ticket_type_id, phase, price, threshold_date, demand_factor_min, demand_factor_max, priority, active)
SELECT id, 'regular', 650.00, NOW() + INTERVAL '60 days', 1.0, 1.3, 20, TRUE
FROM catalog.ticket_types WHERE event_id = 'e0000000-0000-0000-0000-000000000005' AND name = 'Day Pass';

INSERT INTO catalog.pricing_rules (ticket_type_id, phase, price, threshold_qty, demand_factor_min, demand_factor_max, priority, active)
SELECT id, 'late', 780.00, 400, 1.0, 1.0, 30, TRUE
FROM catalog.ticket_types WHERE event_id = 'e0000000-0000-0000-0000-000000000005' AND name = 'Day Pass';

-- Letní festival — Weekend Pass (3 fáze)
INSERT INTO catalog.pricing_rules (ticket_type_id, phase, price, threshold_date, demand_factor_min, demand_factor_max, priority, active)
SELECT id, 'early_bird', 1100.00, NOW() + INTERVAL '70 days', 1.0, 1.0, 10, TRUE
FROM catalog.ticket_types WHERE event_id = 'e0000000-0000-0000-0000-000000000005' AND name = 'Weekend Pass';

INSERT INTO catalog.pricing_rules (ticket_type_id, phase, price, threshold_date, demand_factor_min, demand_factor_max, priority, active)
SELECT id, 'regular', 1500.00, NOW() + INTERVAL '60 days', 1.0, 1.2, 20, TRUE
FROM catalog.ticket_types WHERE event_id = 'e0000000-0000-0000-0000-000000000005' AND name = 'Weekend Pass';

INSERT INTO catalog.pricing_rules (ticket_type_id, phase, price, threshold_qty, demand_factor_min, demand_factor_max, priority, active)
SELECT id, 'late', 1800.00, 300, 1.0, 1.0, 30, TRUE
FROM catalog.ticket_types WHERE event_id = 'e0000000-0000-0000-0000-000000000005' AND name = 'Weekend Pass';

-- Stand-up Comedy — Standard (3 fáze)
INSERT INTO catalog.pricing_rules (ticket_type_id, phase, price, threshold_date, demand_factor_min, demand_factor_max, priority, active)
SELECT id, 'early_bird', 230.00, NOW() + INTERVAL '10 days', 1.0, 1.0, 10, TRUE
FROM catalog.ticket_types WHERE event_id = 'e0000000-0000-0000-0000-000000000006' AND name = 'Standard';

INSERT INTO catalog.pricing_rules (ticket_type_id, phase, price, threshold_date, demand_factor_min, demand_factor_max, priority, active)
SELECT id, 'regular', 300.00, NOW() + INTERVAL '8 days', 1.0, 1.1, 20, TRUE
FROM catalog.ticket_types WHERE event_id = 'e0000000-0000-0000-0000-000000000006' AND name = 'Standard';

INSERT INTO catalog.pricing_rules (ticket_type_id, phase, price, threshold_qty, demand_factor_min, demand_factor_max, priority, active)
SELECT id, 'late', 360.00, 60, 1.0, 1.0, 30, TRUE
FROM catalog.ticket_types WHERE event_id = 'e0000000-0000-0000-0000-000000000006' AND name = 'Standard';

-- Koncert ČF — Parterre Economy (3 fáze)
INSERT INTO catalog.pricing_rules (ticket_type_id, phase, price, threshold_date, demand_factor_min, demand_factor_max, priority, active)
SELECT id, 'early_bird', 300.00, NOW() + INTERVAL '10 days', 1.0, 1.0, 10, TRUE
FROM catalog.ticket_types WHERE event_id = 'e0000000-0000-0000-0000-000000000007' AND name = 'Parterre Economy';

INSERT INTO catalog.pricing_rules (ticket_type_id, phase, price, threshold_date, demand_factor_min, demand_factor_max, priority, active)
SELECT id, 'regular', 400.00, NOW() + INTERVAL '5 days', 1.0, 1.15, 20, TRUE
FROM catalog.ticket_types WHERE event_id = 'e0000000-0000-0000-0000-000000000007' AND name = 'Parterre Economy';

INSERT INTO catalog.pricing_rules (ticket_type_id, phase, price, threshold_qty, demand_factor_min, demand_factor_max, priority, active)
SELECT id, 'late', 480.00, 30, 1.0, 1.0, 30, TRUE
FROM catalog.ticket_types WHERE event_id = 'e0000000-0000-0000-0000-000000000007' AND name = 'Parterre Economy';

-- Unplugged Session — General Admission (3 fáze)
INSERT INTO catalog.pricing_rules (ticket_type_id, phase, price, threshold_date, demand_factor_min, demand_factor_max, priority, active)
SELECT id, 'early_bird', 150.00, NOW() + INTERVAL '40 days', 1.0, 1.0, 10, TRUE
FROM catalog.ticket_types WHERE event_id = 'e0000000-0000-0000-0000-000000000009' AND name = 'General Admission';

INSERT INTO catalog.pricing_rules (ticket_type_id, phase, price, threshold_date, demand_factor_min, demand_factor_max, priority, active)
SELECT id, 'regular', 200.00, NOW() + INTERVAL '30 days', 1.0, 1.1, 20, TRUE
FROM catalog.ticket_types WHERE event_id = 'e0000000-0000-0000-0000-000000000009' AND name = 'General Admission';

INSERT INTO catalog.pricing_rules (ticket_type_id, phase, price, threshold_qty, demand_factor_min, demand_factor_max, priority, active)
SELECT id, 'late', 240.00, 60, 1.0, 1.0, 30, TRUE
FROM catalog.ticket_types WHERE event_id = 'e0000000-0000-0000-0000-000000000009' AND name = 'General Admission';

-- Dětský den — Child (3 fáze)
INSERT INTO catalog.pricing_rules (ticket_type_id, phase, price, threshold_date, demand_factor_min, demand_factor_max, priority, active)
SELECT id, 'early_bird', 120.00, NOW() + INTERVAL '40 days', 1.0, 1.0, 10, TRUE
FROM catalog.ticket_types WHERE event_id = 'e0000000-0000-0000-0000-000000000010' AND name = 'Child (3-14)';

INSERT INTO catalog.pricing_rules (ticket_type_id, phase, price, threshold_date, demand_factor_min, demand_factor_max, priority, active)
SELECT id, 'regular', 150.00, NOW() + INTERVAL '30 days', 1.0, 1.1, 20, TRUE
FROM catalog.ticket_types WHERE event_id = 'e0000000-0000-0000-0000-000000000010' AND name = 'Child (3-14)';

INSERT INTO catalog.pricing_rules (ticket_type_id, phase, price, threshold_qty, demand_factor_min, demand_factor_max, priority, active)
SELECT id, 'late', 180.00, 450, 1.0, 1.0, 30, TRUE
FROM catalog.ticket_types WHERE event_id = 'e0000000-0000-0000-0000-000000000010' AND name = 'Child (3-14)';

-- =============================================================================
-- === SEATS (pro seated venues — mix stavů) ===
-- =============================================================================

-- Divadlo Na Vinohradech — 3 sekce × 5 řad × 12 míst = 180 míst
INSERT INTO catalog.seats (venue_id, section, row, seat_number, zone, status)
SELECT
  'a0000000-0000-0000-0000-000000000003' AS venue_id,
  section,
  'Řada ' || row_num::text,
  'Místo ' || seat_num::text,
  CASE section WHEN 'Přízemí' THEN 'orchestra' ELSE 'balcony' END,
  CASE WHEN random() < 0.70 THEN 'available' WHEN random() < 0.85 THEN 'sold' WHEN random() < 0.95 THEN 'locked' ELSE 'blocked' END
FROM (
  SELECT s, r, n
  FROM unnest(ARRAY['Přízemí', '1. balkón', '2. balkón']) s
  CROSS JOIN generate_series(1, 5) r
  CROSS JOIN generate_series(1, 12) n
) _(section, row_num, seat_num);

-- O2 Arena — 3 sekce × 3 řady × 20 míst = 180 míst
INSERT INTO catalog.seats (venue_id, section, row, seat_number, zone, status)
SELECT
  'a0000000-0000-0000-0000-000000000001' AS venue_id,
  section,
  'Řada ' || row_num::text,
  'Místo ' || seat_num::text,
  CASE section WHEN 'Floor' THEN 'floor' ELSE 'tribune' END,
  CASE WHEN random() < 0.70 THEN 'available' WHEN random() < 0.85 THEN 'sold' WHEN random() < 0.95 THEN 'locked' ELSE 'blocked' END
FROM (
  SELECT s, r, n
  FROM unnest(ARRAY['Floor', 'Tribuna A', 'Tribuna B']) s
  CROSS JOIN generate_series(1, 3) r
  CROSS JOIN generate_series(1, 20) n
) _(section, row_num, seat_num);

-- =============================================================================
-- === ORDERS (300 objednávek — 200 paid, 50 pending, 30 cancelled, 20 refunded) ===
-- =============================================================================

-- 200 PAID objednávek
INSERT INTO orders.orders
(user_id, status, total_amount, currency, gopay_payment_id, gopay_order_id, idempotency_key, expires_at, paid_at)
SELECT
  (ARRAY(SELECT id FROM identity.users LIMIT 500))[1 + ((seq - 1) % 500)] AS user_id,
  'paid' AS status,
  (TRUNC(random() * 30) + 1) * 100.00 + ROUND(random() * 99) AS total_amount,
  'CZK' AS currency,
  '3456789' || LPAD(seq::text, 5, '0') AS gopay_payment_id,
  'gopay_order_' || seq::text AS gopay_order_id,
  gen_random_uuid() AS idempotency_key,
  NOW() + INTERVAL '14 days' AS expires_at,
  NOW() - INTERVAL '1 day' * (random() * 60)::int AS paid_at
FROM generate_series(1, 200) AS seq;

-- 50 PENDING objednávek (čekající na platbu, expires_at v budoucnosti)
INSERT INTO orders.orders
(user_id, status, total_amount, currency, gopay_payment_id, gopay_order_id, idempotency_key, expires_at, paid_at)
SELECT
  (ARRAY(SELECT id FROM identity.users LIMIT 500))[1 + ((seq - 1) % 500)] AS user_id,
  'pending' AS status,
  (TRUNC(random() * 25) + 1) * 100.00 + ROUND(random() * 99) AS total_amount,
  'CZK' AS currency,
  NULL AS gopay_payment_id,
  NULL AS gopay_order_id,
  gen_random_uuid() AS idempotency_key,
  NOW() + INTERVAL '7 days' + INTERVAL '1 day' * (random() * 7)::int AS expires_at,
  NULL AS paid_at
FROM generate_series(201, 250) AS seq;

-- 30 CANCELLED objednávek
INSERT INTO orders.orders
(user_id, status, total_amount, currency, gopay_payment_id, gopay_order_id, idempotency_key, expires_at, paid_at)
SELECT
  (ARRAY(SELECT id FROM identity.users LIMIT 500))[1 + ((seq - 1) % 500)] AS user_id,
  'cancelled' AS status,
  (TRUNC(random() * 20) + 1) * 100.00 + ROUND(random() * 99) AS total_amount,
  'CZK' AS currency,
  '3456789' || LPAD(seq::text, 5, '0') AS gopay_payment_id,
  'gopay_order_' || seq::text AS gopay_order_id,
  gen_random_uuid() AS idempotency_key,
  NOW() - INTERVAL '7 days' - INTERVAL '1 day' * (random() * 5)::int AS expires_at,
  NOW() - INTERVAL '10 day' * (random() * 10)::int AS paid_at
FROM generate_series(251, 280) AS seq;

-- 20 REFUNDED objednávek
INSERT INTO orders.orders
(user_id, status, total_amount, currency, gopay_payment_id, gopay_order_id, idempotency_key, expires_at, paid_at)
SELECT
  (ARRAY(SELECT id FROM identity.users LIMIT 500))[1 + ((seq - 1) % 500)] AS user_id,
  'refunded' AS status,
  (TRUNC(random() * 30) + 1) * 100.00 + ROUND(random() * 99) AS total_amount,
  'CZK' AS currency,
  '3456789' || LPAD(seq::text, 5, '0') AS gopay_payment_id,
  'gopay_order_' || seq::text AS gopay_order_id,
  gen_random_uuid() AS idempotency_key,
  NOW() - INTERVAL '30 days' - INTERVAL '1 day' * (random() * 20)::int AS expires_at,
  NOW() - INTERVAL '25 day' * (random() * 25)::int AS paid_at
FROM generate_series(281, 300) AS seq;

-- =============================================================================
-- === ORDER ITEMS (1–4 položky na objednávku) ===
-- =============================================================================

INSERT INTO orders.order_items (order_id, ticket_type_id, seat_id, quantity, unit_price, total_price)
SELECT
  o.id,
  (ARRAY(SELECT id FROM catalog.ticket_types))[1 + (ROW_NUMBER() OVER (PARTITION BY o.id ORDER BY random()))::int % (SELECT COUNT(*) FROM catalog.ticket_types)],
  CASE WHEN random() < 0.6 THEN (ARRAY(SELECT id FROM catalog.seats WHERE status IN ('available', 'sold', 'locked')))[1 + (ROW_NUMBER() OVER (PARTITION BY o.id ORDER BY random()))::int % 50] ELSE NULL END,
  TRUNC(random() * 3) + 1,
  ROUND((TRUNC(random() * 200) + 100)::numeric, 2),
  NULL
FROM orders.orders o,
     LATERAL generate_series(1, CASE WHEN random() < 0.3 THEN 1 WHEN random() < 0.6 THEN 2 WHEN random() < 0.85 THEN 3 ELSE 4 END)
WHERE o.status IN ('paid', 'refunded', 'cancelled');

-- Kalkulace total_price
UPDATE orders.order_items SET total_price = unit_price * quantity WHERE total_price IS NULL;

-- =============================================================================
-- === PAYMENT EVENTS (pro paid objednávky alespoň 1 PAYMENT_PAID event) ===
-- =============================================================================

INSERT INTO orders.payment_events (order_id, event_type, gopay_status, amount, raw_payload)
SELECT
  id,
  'PAYMENT_PAID',
  'PAID',
  total_amount,
  jsonb_build_object(
    'event_type', 'PAYMENT_PAID',
    'payment_id', gopay_payment_id,
    'status', 'PAID',
    'amount', (total_amount * 100)::int,
    'timestamp', (NOW() - INTERVAL '1 day' * (random() * 60)::int)::text
  )
FROM orders.orders
WHERE status = 'paid';

-- =============================================================================
-- === TICKETS (600 vstupenek — 500 valid, 50 used, 30 revoked, 20 resale_listed) ===
-- =============================================================================

-- 500 VALID vstupenek
INSERT INTO tickets.tickets
(order_id, ticket_type_id, owner_id, original_owner_id, seat_id, status, totp_secret_encrypted, totp_secret_iv, original_price)
SELECT
  o.id,
  oi.ticket_type_id,
  o.user_id,
  o.user_id,
  oi.seat_id,
  'valid',
  decode('a0f4f68d5e1b2c3f8e7d6c5b4a3f2e1d0c5b4a3f2e1d0c5b4a3f2e1d0c5b4a'::text, 'hex'),
  decode('b1e4d9c8f5a3b2c1d0e9f8a7'::text, 'hex'),
  oi.unit_price
FROM orders.orders o
JOIN orders.order_items oi ON o.id = oi.order_id
WHERE o.status = 'paid'
LIMIT 500;

-- 50 USED vstupenek (s gate_scan events)
INSERT INTO tickets.tickets
(order_id, ticket_type_id, owner_id, original_owner_id, seat_id, status, totp_secret_encrypted, totp_secret_iv, original_price, used_at)
SELECT
  o.id,
  oi.ticket_type_id,
  o.user_id,
  o.user_id,
  oi.seat_id,
  'used',
  decode('a0f4f68d5e1b2c3f8e7d6c5b4a3f2e1d0c5b4a3f2e1d0c5b4a3f2e1d0c5b4a'::text, 'hex'),
  decode('b1e4d9c8f5a3b2c1d0e9f8a7'::text, 'hex'),
  oi.unit_price,
  NOW() - INTERVAL '1 day' * (random() * 30)::int
FROM orders.orders o
JOIN orders.order_items oi ON o.id = oi.order_id
WHERE o.status = 'paid'
OFFSET 500
LIMIT 50;

-- 30 REVOKED vstupenek
INSERT INTO tickets.tickets
(order_id, ticket_type_id, owner_id, original_owner_id, seat_id, status, totp_secret_encrypted, totp_secret_iv, original_price, revoked_at)
SELECT
  o.id,
  oi.ticket_type_id,
  o.user_id,
  o.user_id,
  oi.seat_id,
  'revoked',
  decode('a0f4f68d5e1b2c3f8e7d6c5b4a3f2e1d0c5b4a3f2e1d0c5b4a3f2e1d0c5b4a'::text, 'hex'),
  decode('b1e4d9c8f5a3b2c1d0e9f8a7'::text, 'hex'),
  oi.unit_price,
  NOW() - INTERVAL '1 day' * (random() * 60)::int
FROM orders.orders o
JOIN orders.order_items oi ON o.id = oi.order_id
WHERE o.status IN ('cancelled', 'refunded')
LIMIT 30;

-- 20 RESALE_LISTED vstupenek
INSERT INTO tickets.tickets
(order_id, ticket_type_id, owner_id, original_owner_id, seat_id, status, totp_secret_encrypted, totp_secret_iv, original_price)
SELECT
  o.id,
  oi.ticket_type_id,
  o.user_id,
  o.user_id,
  oi.seat_id,
  'resale_listed',
  decode('a0f4f68d5e1b2c3f8e7d6c5b4a3f2e1d0c5b4a3f2e1d0c5b4a3f2e1d0c5b4a'::text, 'hex'),
  decode('b1e4d9c8f5a3b2c1d0e9f8a7'::text, 'hex'),
  oi.unit_price
FROM orders.orders o
JOIN orders.order_items oi ON o.id = oi.order_id
WHERE o.status = 'paid'
OFFSET 550
LIMIT 20;

-- =============================================================================
-- === SCAN LOGS (50 záznamů pro used vstupenky) ===
-- =============================================================================

INSERT INTO tickets.scan_logs (ticket_id, event_id, scanned_by_device_id, scan_result, scanned_at)
SELECT
  t.id,
  CASE
    WHEN random() < 0.2 THEN 'e0000000-0000-0000-0000-000000000001'
    WHEN random() < 0.4 THEN 'e0000000-0000-0000-0000-000000000002'
    WHEN random() < 0.6 THEN 'e0000000-0000-0000-0000-000000000003'
    WHEN random() < 0.8 THEN 'e0000000-0000-0000-0000-000000000004'
    ELSE 'e0000000-0000-0000-0000-000000000005'
  END AS event_id,
  (SELECT id FROM identity.user_devices LIMIT 1),
  'ok',
  t.used_at
FROM tickets.tickets t
WHERE t.status = 'used'
LIMIT 50;

-- =============================================================================
-- === RESALE LISTINGS (20 přeprodejních inzerátů) ===
-- =============================================================================

-- 10 ACTIVE inzeráty (ask_price ≤ original_price)
INSERT INTO resale.resale_listings
(ticket_id, seller_id, buyer_id, ask_price, original_price, status, escrow_status, listed_at, expires_at)
SELECT
  t.id,
  t.owner_id,
  NULL,
  ROUND((t.original_price * (0.8 + random() * 0.2))::numeric, 2),
  t.original_price,
  'active',
  'none',
  NOW() - INTERVAL '1 day' * (random() * 7)::int,
  NOW() + INTERVAL '30 days'
FROM tickets.tickets t
WHERE t.status = 'resale_listed'
LIMIT 10;

-- 5 SOLD inzeráty
INSERT INTO resale.resale_listings
(ticket_id, seller_id, buyer_id, ask_price, original_price, status, escrow_status, listed_at, sold_at)
SELECT
  t.id,
  t.owner_id,
  (ARRAY(SELECT id FROM identity.users LIMIT 500))[1 + (ROW_NUMBER() OVER (ORDER BY random()))::int % 500],
  ROUND((t.original_price * (0.75 + random() * 0.25))::numeric, 2),
  t.original_price,
  'sold',
  'released',
  NOW() - INTERVAL '14 days' - INTERVAL '1 day' * (random() * 7)::int,
  NOW() - INTERVAL '1 day' * (random() * 7)::int
FROM tickets.tickets t
WHERE t.status = 'resale_listed'
OFFSET 10
LIMIT 5;

-- 5 CANCELLED inzeráty
INSERT INTO resale.resale_listings
(ticket_id, seller_id, buyer_id, ask_price, original_price, status, escrow_status, listed_at, cancelled_at)
SELECT
  t.id,
  t.owner_id,
  NULL,
  ROUND((t.original_price * (0.85 + random() * 0.15))::numeric, 2),
  t.original_price,
  'cancelled',
  'none',
  NOW() - INTERVAL '21 days' - INTERVAL '1 day' * (random() * 7)::int,
  NOW() - INTERVAL '14 days' - INTERVAL '1 day' * (random() * 7)::int
FROM tickets.tickets t
WHERE t.status = 'resale_listed'
OFFSET 15
LIMIT 5;

-- =============================================================================
-- === VERIFICATION QUERIES ===
-- =============================================================================

SELECT 'Seed data loaded: ' || COUNT(*) || ' users' FROM identity.users;
SELECT 'Device records: ' || COUNT(*) FROM identity.user_devices;
SELECT 'Refresh tokens: ' || COUNT(*) FROM identity.refresh_tokens;
SELECT 'Venues: ' || COUNT(*) FROM catalog.venues;
SELECT 'Events: ' || COUNT(*) FROM catalog.events;
SELECT 'Ticket types: ' || COUNT(*) FROM catalog.ticket_types;
SELECT 'Pricing rules: ' || COUNT(*) FROM catalog.pricing_rules;
SELECT 'Seats: ' || COUNT(*) FROM catalog.seats;
SELECT 'Orders: ' || COUNT(*) FROM orders.orders;
SELECT 'Order items: ' || COUNT(*) FROM orders.order_items;
SELECT 'Payment events: ' || COUNT(*) FROM orders.payment_events;
SELECT 'Tickets: ' || COUNT(*) FROM tickets.tickets;
SELECT 'Scan logs: ' || COUNT(*) FROM tickets.scan_logs;
SELECT 'Resale listings: ' || COUNT(*) FROM resale.resale_listings;

COMMIT;
