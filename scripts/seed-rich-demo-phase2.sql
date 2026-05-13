BEGIN;
INSERT INTO catalog.venue_seating_charts (id, venue_id, name, layout, total_seats, active, source, notes)
VALUES
  ('00000000-0000-4000-a000-000000000301', '00000000-0000-4000-a000-000000000202', 'Velky koncertni sal — Rudolfinum-style amfiteátr',
    pg_read_file('/tmp/layouts/velky-sal.json')::jsonb,
    1487,
    true, 'seed', 'Generated 2026-04-30 — realistic redesign'),
  ('00000000-0000-4000-a000-000000000302', '00000000-0000-4000-a000-000000000203', 'Aréna Praha — O2-style koncert config',
    pg_read_file('/tmp/layouts/arena.json')::jsonb,
    14840,
    true, 'seed', 'Generated 2026-04-30 — realistic redesign'),
  ('00000000-0000-4000-a000-000000000303', '00000000-0000-4000-a000-000000000204', 'Stadion FC Praha — Letná-style 4 tribuny',
    pg_read_file('/tmp/layouts/stadion.json')::jsonb,
    50000,
    true, 'seed', 'Generated 2026-04-30 — realistic redesign')
ON CONFLICT (id) DO NOTHING;
COMMIT;
