import { describe, it, expect } from 'vitest';
import {
  pickBestAvailable,
  type BestLayout,
  type BestSeat,
} from './best-available';

/**
 * Sál: jeden sektor, tři řady po šesti místech.
 * Řada A je u jeviště (y=10), C nejdál (y=30).
 */
const layout: BestLayout = {
  sectors: [
    {
      name: 'Přízemí',
      rows: [
        { label: 'A', seats: [1, 2, 3, 4, 5, 6].map((n) => ({ num: String(n), x: n * 10, y: 10 })) },
        { label: 'B', seats: [1, 2, 3, 4, 5, 6].map((n) => ({ num: String(n), x: n * 10, y: 20 })) },
        { label: 'C', seats: [1, 2, 3, 4, 5, 6].map((n) => ({ num: String(n), x: n * 10, y: 30 })) },
      ],
    },
  ],
};

function seats(
  spec: Record<string, Partial<Record<string, Partial<BestSeat>>>>,
): BestSeat[] {
  const out: BestSeat[] = [];
  for (const row of ['A', 'B', 'C']) {
    for (let n = 1; n <= 6; n++) {
      const override = spec[row]?.[String(n)] ?? {};
      out.push({
        id: `${row}${n}`,
        sector: 'Přízemí',
        row,
        num: String(n),
        status: 'available',
        ttId: 'tt-1',
        ...override,
      });
    }
  }
  return out;
}

describe('pickBestAvailable', () => {
  it('vybere místa vedle sebe v řadě nejblíž jevišti', () => {
    const r = pickBestAvailable(layout, seats({}), { count: 2 });
    expect(r.contiguous).toBe(true);
    expect(r.row).toBe('A');
    expect(r.seatIds).toHaveLength(2);
  });

  it('preferuje střed řady před krajem', () => {
    const r = pickBestAvailable(layout, seats({}), { count: 2 });
    // Ze šesti míst je střed 3–4.
    expect(r.seatIds).toEqual(['A3', 'A4']);
  });

  it('přeskočí řadu, kde souvislý blok nezbyl', () => {
    // V řadě A zbývají jen krajní místa 1 a 6 — blok pro dva se tam nevejde.
    const r = pickBestAvailable(
      layout,
      seats({ A: { '2': { status: 'sold' }, '3': { status: 'sold' }, '4': { status: 'sold' }, '5': { status: 'sold' } } }),
      { count: 2 },
    );
    expect(r.contiguous).toBe(true);
    expect(r.row).toBe('B');
  });

  it('nemíchá typy vstupenek uvnitř bloku', () => {
    const r = pickBestAvailable(
      layout,
      seats({ A: { '4': { ttId: 'tt-2' }, '5': { ttId: 'tt-2' }, '6': { ttId: 'tt-2' } } }),
      { count: 3, ticketTypeId: 'tt-1' },
    );
    expect(r.seatIds).toEqual(['A1', 'A2', 'A3']);
  });

  it('respektuje filtr na typ vstupenky', () => {
    const r = pickBestAvailable(
      layout,
      seats({ A: { '1': { ttId: 'tt-2' }, '2': { ttId: 'tt-2' }, '3': { ttId: 'tt-2' }, '4': { ttId: 'tt-2' }, '5': { ttId: 'tt-2' }, '6': { ttId: 'tt-2' } } }),
      { count: 2, ticketTypeId: 'tt-2' },
    );
    expect(r.row).toBe('A');
    expect(r.seatIds.every((id) => id.startsWith('A'))).toBe(true);
  });

  it('bezbariérová místa nebere, pokud si o ně kupující neřekne', () => {
    const acc = seats({});
    for (const s of acc) if (s.row === 'A') s.acc = true;
    const r = pickBestAvailable(layout, acc, { count: 2 });
    expect(r.row).toBe('B');

    const rAcc = pickBestAvailable(layout, acc, { count: 2, includeAccessible: true });
    expect(rAcc.row).toBe('A');
  });

  it('když blok neexistuje, vrátí jednotlivá místa a označí to', () => {
    // Volné zůstane jen A1, B3 a C5 — nikde nejsou dvě vedle sebe.
    const all = seats({});
    const keep = new Set(['A1', 'B3', 'C5']);
    for (const s of all) if (!keep.has(s.id)) s.status = 'sold';

    const r = pickBestAvailable(layout, all, { count: 2 });
    expect(r.contiguous).toBe(false);
    expect(r.found).toBe(2);
    // Nejblíž jevišti nejdřív.
    expect(r.seatIds[0]).toBe('A1');
  });

  it('vrátí méně míst, než bylo požadováno, a řekne kolik', () => {
    const all = seats({});
    for (const s of all) if (s.id !== 'B3') s.status = 'sold';

    const r = pickBestAvailable(layout, all, { count: 4 });
    expect(r.found).toBe(1);
    expect(r.seatIds).toEqual(['B3']);
    expect(r.reason).toContain('1');
  });

  it('vyprodaný sál vrátí prázdný výběr, ne výjimku', () => {
    const all = seats({});
    for (const s of all) s.status = 'sold';

    const r = pickBestAvailable(layout, all, { count: 2 });
    expect(r.seatIds).toEqual([]);
    expect(r.found).toBe(0);
    expect(r.reason).toContain('nejsou volná místa');
  });

  it('držená a vyřazená místa se chovají jako obsazená', () => {
    const all = seats({});
    for (const s of all) {
      if (s.row === 'A') s.status = 'held';
      if (s.row === 'B') s.status = 'blocked';
    }
    const r = pickBestAvailable(layout, all, { count: 2 });
    expect(r.row).toBe('C');
  });

  it('ošetří nesmyslný počet míst', () => {
    const r = pickBestAvailable(layout, seats({}), { count: 0 });
    expect(r.found).toBe(1);

    const rBig = pickBestAvailable(layout, seats({}), { count: 999, maxCount: 4 });
    expect(rBig.found).toBe(4);
  });
});
