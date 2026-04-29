-- Phase 1: Promoters + Venues
-- Hash for "Demo2026!" (bcrypt 10 rounds, same as existing demo accounts)
BEGIN;

-- 1) Archivuj 261 prázdných test venues "Online / TBD"
UPDATE catalog.venues
SET archived_at = NOW(), status = 'archived'
WHERE name IN ('Online / TBD', 'ffff') AND archived_at IS NULL;

-- 2) Přidej 4 nové users + promotéry
INSERT INTO identity.users (id, email, name, password_hash, email_verified_at, gdpr_consent_at, is_platform_admin)
VALUES
  ('00000000-0000-4000-a000-000000000030', 'theatre@hranice.cz',  'Divadlo Hranice s.r.o.',     '$2b$10$.GIsSaNWGnm/jz38S.x.9eFd5OFpWjxYLNfa1DRIBL2ZcNh3t056S', NOW(), NOW(), false),
  ('00000000-0000-4000-a000-000000000031', 'koncerty@nationalgroup.cz', 'National Concert Group', '$2b$10$.GIsSaNWGnm/jz38S.x.9eFd5OFpWjxYLNfa1DRIBL2ZcNh3t056S', NOW(), NOW(), false),
  ('00000000-0000-4000-a000-000000000032', 'arena@multiprod.cz',  'MultiArena Productions s.r.o.', '$2b$10$.GIsSaNWGnm/jz38S.x.9eFd5OFpWjxYLNfa1DRIBL2ZcNh3t056S', NOW(), NOW(), false),
  ('00000000-0000-4000-a000-000000000033', 'klub@underground.cz', 'Klub Underground Brno',       '$2b$10$.GIsSaNWGnm/jz38S.x.9eFd5OFpWjxYLNfa1DRIBL2ZcNh3t056S', NOW(), NOW(), false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO platform.promoters (id, email, name, slug, status, contact_email, brand_color_hex, brand_tagline, vat_rate_pct, vat_payer, company_ico, company_address, kyc_status)
VALUES
  ('00000000-0000-4000-a000-000000000111', 'theatre@hranice.cz',         'Divadlo Hranice s.r.o.',         'divadlo-hranice', 'active', 'theatre@hranice.cz',         '#8b5a2b', 'Kultura na malem meste',          21, true,  '12345601', 'Hranice 1, 75301',     'approved'),
  ('00000000-0000-4000-a000-000000000112', 'koncerty@nationalgroup.cz',  'National Concert Group',         'national-concert','active', 'koncerty@nationalgroup.cz',  '#1e40af', 'Velke koncerty pro Prahu',        21, true,  '12345602', 'Praha 1, 11000',       'approved'),
  ('00000000-0000-4000-a000-000000000113', 'arena@multiprod.cz',         'MultiArena Productions s.r.o.',  'multiarena',      'active', 'arena@multiprod.cz',         '#dc2626', 'Arena i stadion pod jednou strechou', 21, true,  '12345603', 'Praha 9, 19000',       'approved'),
  ('00000000-0000-4000-a000-000000000114', 'klub@underground.cz',        'Klub Underground Brno',          'klub-underground','active', 'klub@underground.cz',        '#7c3aed', 'Punk, rock a undergroundova scena', 21, false, '12345604', 'Brno, Cejl 12, 60200', 'approved')
ON CONFLICT (id) DO NOTHING;

INSERT INTO platform.promoter_members (promoter_id, user_id, role, status)
VALUES
  ('00000000-0000-4000-a000-000000000111', '00000000-0000-4000-a000-000000000030', 'owner', 'active'),
  ('00000000-0000-4000-a000-000000000112', '00000000-0000-4000-a000-000000000031', 'owner', 'active'),
  ('00000000-0000-4000-a000-000000000113', '00000000-0000-4000-a000-000000000032', 'owner', 'active'),
  ('00000000-0000-4000-a000-000000000114', '00000000-0000-4000-a000-000000000033', 'owner', 'active')
ON CONFLICT DO NOTHING;

-- 3) 4 nové sály
INSERT INTO catalog.venues (id, name, address, city, country, capacity, venue_type, status, gps_lat, gps_lng, description)
VALUES
  ('00000000-0000-4000-a000-000000000201', 'Velky koncertni sal Praha', 'Narodni 12, Praha 1',         'Praha', 'CZ',  1500, 'venue',   'published', 50.0810, 14.4127, 'Klasicky koncertni sal se 1 500 sedadly. Parter, balkon, loze.'),
  ('00000000-0000-4000-a000-000000000202', 'Klub Underground Brno',     'Cejl 12, Brno',               'Brno',  'CZ',   200, 'club',    'published', 49.2002, 16.6168, 'Punkovy klub bez sedadel. 200 standing. Jeviste + bar.'),
  ('00000000-0000-4000-a000-000000000203', 'Arena Praha',               'Ceskomoravska 17, Praha 9',   'Praha', 'CZ', 17000, 'arena',   'published', 50.1051, 14.4920, 'Multifunkcni arena pro 17 000 navstevniku. Hokej, koncerty, basketbal.'),
  ('00000000-0000-4000-a000-000000000204', 'Stadion FC Praha',          'Strahovska 1200, Praha 6',    'Praha', 'CZ', 50000, 'stadium', 'published', 50.0826, 14.3905, 'Fotbalovy stadion 50 000. 4 tribuny: Sever, Jih, Vychod, Zapad.')
ON CONFLICT (id) DO NOTHING;

-- 4) Linkuj sály na promotéry
UPDATE catalog.venues SET promoter_id = '00000000-0000-4000-a000-000000000111' WHERE id = 'ba5a2248-c11c-42ec-85fe-63929f4d4f3f';
UPDATE catalog.venues SET promoter_id = '00000000-0000-4000-a000-000000000112' WHERE id = '00000000-0000-4000-a000-000000000201';
UPDATE catalog.venues SET promoter_id = '00000000-0000-4000-a000-000000000114' WHERE id = '00000000-0000-4000-a000-000000000202';
UPDATE catalog.venues SET promoter_id = '00000000-0000-4000-a000-000000000113' WHERE id = '00000000-0000-4000-a000-000000000203';
UPDATE catalog.venues SET promoter_id = '00000000-0000-4000-a000-000000000113' WHERE id = '00000000-0000-4000-a000-000000000204';

COMMIT;

-- Ověření
SELECT v.id, v.name, v.city, v.capacity, v.venue_type, COALESCE(p.name, '<bez>') as promoter, v.status, v.archived_at IS NOT NULL as archivovano
FROM catalog.venues v
LEFT JOIN platform.promoters p ON p.id = v.promoter_id
WHERE v.archived_at IS NULL
ORDER BY v.capacity;

SELECT id, email, name, status, slug FROM platform.promoters ORDER BY name;
