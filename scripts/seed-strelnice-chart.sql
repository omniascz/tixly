-- Self-contained seating chart pro Divadlo Stará střelnice (ba5a2248) — golden-path.
-- ODDĚLENO z phase2 (2026-06-01): phase2 je GENEROVANÝ soubor
-- (scripts/generate-rich-layouts.mjs ho přepisuje), tak sem dáme durable chart,
-- který generátor nezničí a který NEzávisí na /tmp/layouts souborech.
-- Spustit PŘED phase3-seats (po phase1, kde vzniká venue).
--
-- Sektory MUSÍ odpovídat zónám, které phase3-seats nastavuje na ticket_types:
--   PŘÍZEMÍ 232, BALKON STŘED 45, BALKON VLEVO 16, BALKON VPRAVO 15 = 308.
-- sector.name == ticket_type.zone → copy_layout_to_event_seats namapuje sedadla.

BEGIN;
INSERT INTO catalog.venue_seating_charts (id, venue_id, name, layout, total_seats, active, source, notes)
SELECT
  '00000000-0000-4000-a000-000000000304',
  'ba5a2248-c11c-42ec-85fe-63929f4d4f3f',
  'Stará střelnice — přízemí + balkon (L/střed/P)',
  jsonb_build_object('sectors', jsonb_build_array(
    jsonb_build_object('name', 'PŘÍZEMÍ', 'rows', (
      SELECT jsonb_agg(row_json ORDER BY ridx) FROM (
        SELECT i/20 AS ridx,
          jsonb_build_object('label', ((i/20)+1)::text,
            'seats', jsonb_agg(jsonb_build_object('num', ((i%20)+1)::text, 'x', (i%20)*30, 'y', (i/20)*30) ORDER BY (i%20))) AS row_json
        FROM generate_series(0, 231) AS g(i) GROUP BY i/20
      ) q)),
    jsonb_build_object('name', 'BALKON STŘED', 'rows', (
      SELECT jsonb_agg(row_json ORDER BY ridx) FROM (
        SELECT i/15 AS ridx,
          jsonb_build_object('label', 'S'||((i/15)+1)::text,
            'seats', jsonb_agg(jsonb_build_object('num', ((i%15)+1)::text, 'x', (i%15)*30, 'y', 400+(i/15)*30) ORDER BY (i%15))) AS row_json
        FROM generate_series(0, 44) AS g(i) GROUP BY i/15
      ) q)),
    jsonb_build_object('name', 'BALKON VLEVO', 'rows', (
      SELECT jsonb_agg(row_json ORDER BY ridx) FROM (
        SELECT i/8 AS ridx,
          jsonb_build_object('label', 'L'||((i/8)+1)::text,
            'seats', jsonb_agg(jsonb_build_object('num', ((i%8)+1)::text, 'x', (i%8)*30, 'y', 520+(i/8)*30) ORDER BY (i%8))) AS row_json
        FROM generate_series(0, 15) AS g(i) GROUP BY i/8
      ) q)),
    jsonb_build_object('name', 'BALKON VPRAVO', 'rows', (
      SELECT jsonb_agg(row_json ORDER BY ridx) FROM (
        SELECT i/8 AS ridx,
          jsonb_build_object('label', 'P'||((i/8)+1)::text,
            'seats', jsonb_agg(jsonb_build_object('num', ((i%8)+1)::text, 'x', 600+(i%8)*30, 'y', 520+(i/8)*30) ORDER BY (i%8))) AS row_json
        FROM generate_series(0, 14) AS g(i) GROUP BY i/8
      ) q))
  )),
  308, true, 'seed', 'Self-contained golden-path chart (2026-06-01)'
WHERE NOT EXISTS (
  SELECT 1 FROM catalog.venue_seating_charts WHERE id = '00000000-0000-4000-a000-000000000304'
);
COMMIT;
