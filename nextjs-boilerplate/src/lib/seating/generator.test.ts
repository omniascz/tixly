/** Kolo 8 / krok 2 — generátor sekcí, přečíslování, kopie řady a validace plánku (čisté funkce). */
import { describe, expect, it } from 'vitest';
import { copyRows, duplicateSeatLabels, generateSection, renumberSeats, seatCount } from './generator';
import { layoutSchema } from './layout-schema';

describe('generateSection', () => {
  it('řady a místa vzestupně, uličky, posun řad', () => {
    const s = generateSection({ name: 'Přízemí', rows: 3, seatsPerRow: 10, rowLabels: 'number', seatNumbering: 'asc', aisleAfter: [5], aisleGap: 2, rowOffset: 10, origin: { x: 100, y: 200 }, spacing: 30 });
    expect(s.name).toBe('Přízemí');
    expect(s.rows.map((r) => r.label)).toEqual(['1', '2', '3']);
    expect(s.rows[0].seats.map((x) => x.num)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10']);
    // ulička po 5. místě: mezera = (1 + aisleGap) × spacing
    expect(s.rows[0].seats[5].x - s.rows[0].seats[4].x).toBe(90);
    expect(s.rows[0].seats[1].x - s.rows[0].seats[0].x).toBe(30);
    // posun řady (lichá/sudá řada) o rowOffset
    expect(s.rows[1].seats[0].x - s.rows[0].seats[0].x).toBe(10);
    expect(s.rows[2].seats[0].x - s.rows[0].seats[0].x).toBe(0);
    expect(s.rows[1].seats[0].y - s.rows[0].seats[0].y).toBe(30);
  });

  it('číslování sestupně, řady písmeny sestupně od zadaného písmene', () => {
    const s = generateSection({ name: 'Balkon', rows: 3, seatsPerRow: 4, rowLabels: 'letter', rowStart: 'C', rowOrder: 'desc', seatNumbering: 'desc' });
    expect(s.rows.map((r) => r.label)).toEqual(['C', 'B', 'A']);
    expect(s.rows[0].seats.map((x) => x.num)).toEqual(['4', '3', '2', '1']);
  });

  it('liché/sudé strany: zleva liché sestupně ke středu, zprava sudé vzestupně (divadelní číslování)', () => {
    const s = generateSection({ name: 'Lóže', rows: 1, seatsPerRow: 8, seatNumbering: 'odd-even' });
    expect(s.rows[0].seats.map((x) => x.num)).toEqual(['7', '5', '3', '1', '2', '4', '6', '8']);
  });

  it('první řada a místo od zadaného čísla', () => {
    const s = generateSection({ name: 'X', rows: 2, seatsPerRow: 3, rowStart: '5', seatStart: 11 });
    expect(s.rows.map((r) => r.label)).toEqual(['5', '6']);
    expect(s.rows[0].seats.map((x) => x.num)).toEqual(['11', '12', '13']);
  });
});

describe('renumberSeats / copyRows / duplicity', () => {
  const base = generateSection({ name: 'P', rows: 2, seatsPerRow: 4 });

  it('přečíslování výběru (v řadě podle pozice zleva), od čísla a s krokem', () => {
    const sel = new Set(['P|1|2', 'P|1|3', 'P|1|4']);
    const out = renumberSeats([base], sel, { start: 20, step: 2 });
    expect(out[0].rows[0].seats.map((s) => s.num)).toEqual(['1', '20', '22', '24']);
    expect(out[0].rows[1].seats.map((s) => s.num)).toEqual(['1', '2', '3', '4']);
  });

  it('kopie řady: nová řada s dalším označením posunutá dolů', () => {
    const out = copyRows([base], 'P', ['2'], 40);
    expect(out[0].rows.map((r) => r.label)).toEqual(['1', '2', '3']);
    expect(out[0].rows[2].seats[0].y - out[0].rows[1].seats[0].y).toBe(40);
    expect(out[0].rows[2].seats.map((s) => s.num)).toEqual(['1', '2', '3', '4']);
  });

  it('duplicitní označení (sekce + řada + místo) se najde a plánek nejde uložit', () => {
    const dup = renumberSeats([base], new Set(['P|1|2']), { start: 1, step: 1 });
    expect(duplicateSeatLabels(dup)).toEqual(['P / řada 1 / místo 1']);
    const r = layoutSchema.safeParse({ viewBox: '0 0 100 100', sectors: dup });
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.success ? null : r.error.issues)).toContain('DUPLICATE_SEAT');
    expect(layoutSchema.safeParse({ viewBox: '0 0 100 100', sectors: [base] }).success).toBe(true);
  });
});

describe('layoutSchema — typy míst, cenové zóny, podklad', () => {
  it('přijme typy míst, poznámku, zóny s barvou a nastavení podkladu; zóna místa musí existovat', () => {
    const s = generateSection({ name: 'P', rows: 1, seatsPerRow: 3 });
    s.rows[0].seats[0] = { ...s.rows[0].seats[0], type: 'wheelchair', zone: 'z1' };
    s.rows[0].seats[1] = { ...s.rows[0].seats[1], type: 'companion', zone: 'z1' };
    s.rows[0].seats[2] = { ...s.rows[0].seats[2], type: 'restricted', note: 'sloup', zone: 'z2' };
    const ok = layoutSchema.safeParse({
      viewBox: '0 0 500 500', sectors: [s],
      zones: [{ id: 'z1', name: 'A', color: '#ff0000' }, { id: 'z2', name: 'B', color: '#00ff00' }],
      underlay: { opacity: 0.4, scale: 1.5, x: -20, y: 10 }, floorPlanUrl: 'data:image/png;base64,AAAA',
    });
    expect(ok.success, JSON.stringify(ok.success ? null : ok.error.issues)).toBe(true);
    const bad = layoutSchema.safeParse({ viewBox: '0 0 500 500', sectors: [s], zones: [{ id: 'z1', name: 'A', color: '#ff0000' }] });
    expect(bad.success).toBe(false);
    expect(JSON.stringify(bad.success ? null : bad.error.issues)).toContain('UNKNOWN_ZONE');
  });

  it('300 míst ve 3 sekcích generátorem', () => {
    const secs = [
      generateSection({ name: 'Přízemí', rows: 10, seatsPerRow: 18 }),
      generateSection({ name: 'Balkon', rows: 5, seatsPerRow: 20, origin: { x: 0, y: 500 } }),
      generateSection({ name: 'Lóže', rows: 2, seatsPerRow: 10, origin: { x: 0, y: 800 }, seatNumbering: 'odd-even' }),
    ];
    expect(seatCount(secs)).toBe(300);
    expect(duplicateSeatLabels(secs)).toEqual([]);
  });
});
