-- Phase 3b: oprav ticket types + kopiruj layout do event_seats
BEGIN;

-- ===== Oprav ticket_types tak, aby se zone shodovaly s sektory v layoutu =====

-- Stara Strelnice: PŘÍZEMÍ (232), BALKON STŘED (45), BALKON VLEVO (16), BALKON VPRAVO (15)
-- Nejdriv smazeme vsechny stare ticket types pro 3 stare-strelnice eventy, pak insertujeme nove
DELETE FROM catalog.ticket_types WHERE event_id IN (
  '00000000-0000-4000-a000-000000000401',
  '00000000-0000-4000-a000-000000000402',
  '00000000-0000-4000-a000-000000000410'
);

-- Romeo a Julie (event 401) — IDs 5A1-5A4
INSERT INTO catalog.ticket_types (id, event_id, name, kind, base_price, total_qty, remaining_qty, max_per_user, zone, is_seated, attendance_type)
VALUES
  ('00000000-0000-4000-a000-0000000005a1', '00000000-0000-4000-a000-000000000401', 'Prizemi (radove sedadlo)', 'seated', 35000, 232, 232, 4, 'PŘÍZEMÍ',       true, 'physical'),
  ('00000000-0000-4000-a000-0000000005a2', '00000000-0000-4000-a000-000000000401', 'Balkon stred',              'seated', 28000, 45,  45,  4, 'BALKON STŘED',  true, 'physical'),
  ('00000000-0000-4000-a000-0000000005a3', '00000000-0000-4000-a000-000000000401', 'Balkon vlevo',              'seated', 22000, 16,  16,  4, 'BALKON VLEVO',  true, 'physical'),
  ('00000000-0000-4000-a000-0000000005a4', '00000000-0000-4000-a000-000000000401', 'Balkon vpravo',             'seated', 22000, 15,  15,  4, 'BALKON VPRAVO', true, 'physical');

-- Hamlet (event 402) — IDs 5B1-5B4
INSERT INTO catalog.ticket_types (id, event_id, name, kind, base_price, total_qty, remaining_qty, max_per_user, zone, is_seated, attendance_type)
VALUES
  ('00000000-0000-4000-a000-0000000005b1', '00000000-0000-4000-a000-000000000402', 'Prizemi',       'seated', 35000, 232, 232, 4, 'PŘÍZEMÍ',       true, 'physical'),
  ('00000000-0000-4000-a000-0000000005b2', '00000000-0000-4000-a000-000000000402', 'Balkon stred',  'seated', 28000, 45,  45,  4, 'BALKON STŘED',  true, 'physical'),
  ('00000000-0000-4000-a000-0000000005b3', '00000000-0000-4000-a000-000000000402', 'Balkon vlevo',  'seated', 22000, 16,  16,  4, 'BALKON VLEVO',  true, 'physical'),
  ('00000000-0000-4000-a000-0000000005b4', '00000000-0000-4000-a000-000000000402', 'Balkon vpravo', 'seated', 22000, 15,  15,  4, 'BALKON VPRAVO', true, 'physical');

-- Strindberg (event 410, sold out) — IDs 5C1-5C4
INSERT INTO catalog.ticket_types (id, event_id, name, kind, base_price, total_qty, remaining_qty, max_per_user, zone, is_seated, attendance_type)
VALUES
  ('00000000-0000-4000-a000-0000000005c1', '00000000-0000-4000-a000-000000000410', 'Prizemi',       'seated', 30000, 232, 0, 4, 'PŘÍZEMÍ',       true, 'physical'),
  ('00000000-0000-4000-a000-0000000005c2', '00000000-0000-4000-a000-000000000410', 'Balkon stred',  'seated', 22000, 45,  0, 4, 'BALKON STŘED',  true, 'physical'),
  ('00000000-0000-4000-a000-0000000005c3', '00000000-0000-4000-a000-000000000410', 'Balkon vlevo',  'seated', 18000, 16,  0, 4, 'BALKON VLEVO',  true, 'physical'),
  ('00000000-0000-4000-a000-0000000005c4', '00000000-0000-4000-a000-000000000410', 'Balkon vpravo', 'seated', 18000, 15,  0, 4, 'BALKON VPRAVO', true, 'physical');

-- ===== Funkce: kopiruj layout aktivniho sal-chartu do event_seats =====
-- Mapuje sektor v layoutu na ticket_type podle prefix-match nebo presne shody zone

CREATE OR REPLACE FUNCTION pg_temp.copy_layout_to_event_seats(p_event_id uuid)
RETURNS integer AS $$
DECLARE
  v_layout jsonb;
  v_venue_id uuid;
  v_sector jsonb;
  v_row jsonb;
  v_seat jsonb;
  v_sector_name text;
  v_row_label text;
  v_seat_num text;
  v_seat_x numeric;
  v_seat_y numeric;
  v_ticket_type_id uuid;
  v_count integer := 0;
BEGIN
  SELECT venue_id INTO v_venue_id FROM catalog.events WHERE id = p_event_id;
  IF v_venue_id IS NULL THEN
    RAISE EXCEPTION 'Event % has no venue', p_event_id;
  END IF;
  SELECT layout INTO v_layout FROM catalog.venue_seating_charts WHERE venue_id = v_venue_id AND active = true ORDER BY created_at DESC LIMIT 1;
  IF v_layout IS NULL THEN
    -- POZN. (oprava 2026-06-01): dříve RAISE EXCEPTION, což shodilo celou
    -- phase3-seats transakci (a tím i Romeo/Hamlet sedadla) kvůli jednomu
    -- venue bez chartu. Teď event bez chartu přeskočíme (0 sedadel).
    RAISE NOTICE 'Venue % nemá aktivní seating chart — event % přeskočen (0 sedadel)', v_venue_id, p_event_id;
    RETURN 0;
  END IF;

  FOR v_sector IN SELECT jsonb_array_elements(v_layout->'sectors') LOOP
    v_sector_name := v_sector->>'name';
    -- Najdi ticket_type: nejdriv presny match na zone, pak prefix-match (sektor "LB-101" -> ticket_type zone="LB")
    SELECT id INTO v_ticket_type_id
    FROM catalog.ticket_types
    WHERE event_id = p_event_id AND zone = v_sector_name
    LIMIT 1;
    IF v_ticket_type_id IS NULL THEN
      SELECT id INTO v_ticket_type_id
      FROM catalog.ticket_types
      WHERE event_id = p_event_id AND zone IS NOT NULL AND v_sector_name LIKE zone || '%'
      ORDER BY length(zone) DESC -- nejdelsi prefix vyhrava
      LIMIT 1;
    END IF;
    -- Pokud nenajdeme typ, sektor preskocime (volitelne mohli bychom error-out)
    IF v_ticket_type_id IS NULL THEN
      CONTINUE;
    END IF;

    FOR v_row IN SELECT jsonb_array_elements(v_sector->'rows') LOOP
      v_row_label := v_row->>'label';
      FOR v_seat IN SELECT jsonb_array_elements(v_row->'seats') LOOP
        v_seat_num := v_seat->>'num';
        v_seat_x := (v_seat->>'x')::numeric;
        v_seat_y := (v_seat->>'y')::numeric;
        INSERT INTO catalog.event_seats (event_id, ticket_type_id, sector, row, seat_number, x_coord, y_coord, status, accessibility)
        VALUES (p_event_id, v_ticket_type_id, v_sector_name, v_row_label, v_seat_num, v_seat_x, v_seat_y, 'available', false)
        ON CONFLICT (event_id, event_day_id, sector, row, seat_number) DO NOTHING;
        v_count := v_count + 1;
      END LOOP;
    END LOOP;
  END LOOP;
  RETURN v_count;
END;
$$ LANGUAGE plpgsql;

-- Spust pro vsechny eventy se sedadly
SELECT '401 Romeo a Julie' as event, pg_temp.copy_layout_to_event_seats('00000000-0000-4000-a000-000000000401') as seats_created;
SELECT '402 Hamlet' as event, pg_temp.copy_layout_to_event_seats('00000000-0000-4000-a000-000000000402') as seats_created;
SELECT '410 Strindberg' as event, pg_temp.copy_layout_to_event_seats('00000000-0000-4000-a000-000000000410') as seats_created;
SELECT '403 Symfonicky koncert' as event, pg_temp.copy_layout_to_event_seats('00000000-0000-4000-a000-000000000403') as seats_created;
SELECT '404 Mainstream Arena' as event, pg_temp.copy_layout_to_event_seats('00000000-0000-4000-a000-000000000404') as seats_created;
SELECT '405 Derby Stadion' as event, pg_temp.copy_layout_to_event_seats('00000000-0000-4000-a000-000000000405') as seats_created;

-- ===== Inventory sync (oprava 2026-06-01) =====
-- Sjednoť ticket_type.total_qty/remaining_qty se SKUTEČNĚ vytvořenými event_seats.
-- Ručně psané kulaté počty (3000/6000/12500…) nesedělé s generovaným layoutem
-- → oversell/undersell. Zdroj pravdy pro seated typy jsou event_seats.
UPDATE catalog.ticket_types tt
SET total_qty     = sub.cnt,
    remaining_qty = sub.avail
FROM (
  SELECT ticket_type_id,
         COUNT(*) AS cnt,
         COUNT(*) FILTER (WHERE status = 'available') AS avail
  FROM catalog.event_seats
  WHERE event_id::text LIKE '00000000-0000-4000-a000-0000000004%'
    AND ticket_type_id IS NOT NULL
  GROUP BY ticket_type_id
) sub
WHERE tt.id = sub.ticket_type_id;

COMMIT;

-- Overeni
SELECT e.title, COUNT(es.id) as event_seats, COUNT(es.id) FILTER (WHERE es.status = 'available') as available
FROM catalog.events e
LEFT JOIN catalog.event_seats es ON es.event_id = e.id
WHERE e.id::text LIKE '00000000-0000-4000-a000-0000000004%'
GROUP BY e.id, e.title
ORDER BY COUNT(es.id) DESC;
