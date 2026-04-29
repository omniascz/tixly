import { describe, it, expect } from 'vitest';
import {
  renumberRows,
  renameSector,
  spatialCluster,
  splitSectorBySpatial,
  flattenSector,
  setStage,
  suggestSplit,
  analyzeForSuggestions,
  type Layout,
} from './transforms';

const sampleLayout: Layout = {
  viewBox: '0 0 1000 1000',
  sectors: [
    {
      name: 'Sektor A',
      color: '#ff0000',
      rows: [
        { label: 'A', seats: [{ num: '1', x: 10, y: 10 }, { num: '2', x: 20, y: 10 }] },
        { label: 'B', seats: [{ num: '1', x: 10, y: 20 }, { num: '2', x: 20, y: 20 }] },
        { label: 'C', seats: [{ num: '1', x: 10, y: 30 }] },
      ],
    },
  ],
};

describe('renumberRows', () => {
  it('converts alpha to numeric', () => {
    const r = renumberRows(sampleLayout, 'Sektor A', 'numeric');
    expect(r.sectors[0]!.rows.map((row) => row.label)).toEqual(['1', '2', '3']);
  });
  it('numeric with custom start', () => {
    const r = renumberRows(sampleLayout, 'Sektor A', 'numeric', { start: 5 });
    expect(r.sectors[0]!.rows.map((row) => row.label)).toEqual(['5', '6', '7']);
  });
  it('numeric-reverse', () => {
    const r = renumberRows(sampleLayout, 'Sektor A', 'numeric-reverse');
    expect(r.sectors[0]!.rows.map((row) => row.label)).toEqual(['3', '2', '1']);
  });
  it('alpha-reverse', () => {
    const r = renumberRows(sampleLayout, 'Sektor A', 'alpha-reverse');
    expect(r.sectors[0]!.rows.map((row) => row.label)).toEqual(['C', 'B', 'A']);
  });
  it('custom labels', () => {
    const r = renumberRows(sampleLayout, 'Sektor A', 'custom', {
      customLabels: ['parter', 'lóže', 'zadní'],
    });
    expect(r.sectors[0]!.rows.map((row) => row.label)).toEqual(['parter', 'lóže', 'zadní']);
  });
  it('does not modify other sectors', () => {
    const layout: Layout = {
      ...sampleLayout,
      sectors: [
        ...sampleLayout.sectors,
        { name: 'B', rows: [{ label: 'X', seats: [{ num: '1', x: 0, y: 0 }] }] },
      ],
    };
    const r = renumberRows(layout, 'Sektor A', 'numeric');
    expect(r.sectors[1]!.rows[0]!.label).toBe('X');
  });
});

describe('renameSector', () => {
  it('renames matching sector', () => {
    const r = renameSector(sampleLayout, 'Sektor A', 'Přízemí');
    expect(r.sectors[0]!.name).toBe('Přízemí');
  });
  it('does nothing if no match', () => {
    const r = renameSector(sampleLayout, 'Foo', 'Bar');
    expect(r.sectors[0]!.name).toBe('Sektor A');
  });
});

describe('spatialCluster', () => {
  it('groups close seats into one cluster', () => {
    const seats = [
      { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 },
    ];
    expect(spatialCluster(seats, 50)).toHaveLength(1);
  });
  it('separates far-apart seats', () => {
    const seats = [
      { x: 0, y: 0 }, { x: 10, y: 0 },     // cluster 1
      { x: 1000, y: 0 }, { x: 1010, y: 0 }, // cluster 2
    ];
    expect(spatialCluster(seats, 50)).toHaveLength(2);
  });
  it('handles 3-cluster layout (left/center/right balcony)', () => {
    const seats = [
      // Left balcony (x ~330)
      { x: 330, y: 100 }, { x: 330, y: 150 }, { x: 330, y: 200 },
      // Center balcony (x ~700-820, dense row)
      { x: 700, y: 1700 }, { x: 750, y: 1700 }, { x: 800, y: 1700 },
      // Right balcony (x ~1850)
      { x: 1850, y: 100 }, { x: 1850, y: 150 },
    ];
    const clusters = spatialCluster(seats, 80);
    expect(clusters).toHaveLength(3);
  });

  it('anisotropic Y connects vertically distant rows in same X-band', () => {
    // Side balcony top group + bottom group at same x, Y-gap between groups 200px.
    const seats = [
      { x: 338, y: 100 }, { x: 338, y: 147 }, { x: 338, y: 194 }, // top, ~47px steps
      { x: 338, y: 394 }, { x: 338, y: 441 }, // bottom, after 200px Y-gap
    ];
    // Symmetric 80: 200px Y-gap > 80 → splits into 2 clusters
    expect(spatialCluster(seats, 80, 80)).toHaveLength(2);
    // Anisotropic 150/250: 200 ≤ 250 → connects
    expect(spatialCluster(seats, 150, 250)).toHaveLength(1);
  });

  it('anisotropic X tolerates aisle inside a sector', () => {
    // Přízemí row with aisle: seat-to-seat ~42px, aisle gap 84px (real smsticket data)
    const seats = [
      { x: 335, y: 1452 }, { x: 377, y: 1452 }, { x: 1133, y: 1452 },
      // Aisle 84px:
      { x: 1217, y: 1452 }, { x: 1259, y: 1452 },
    ];
    // Note: 335→377 = 42 ✓, 377→1133 = 756 ✗ at any reasonable threshold (different parts of row)
    // The point: with X=150, aisle 84 connects 1133↔1217. 335-1133 stays separate (756 > 150).
    // With X=80, aisle 84 > 80 → 1133↔1217 don't connect either.
    expect(spatialCluster(seats, 80, 80).length).toBeGreaterThanOrEqual(2);
    // Anisotropic 150/250 unifies the right side (1133↔1217 connect via aisle 84≤150)
    const aniso = spatialCluster(seats, 150, 250);
    expect(aniso.some((c) => c.length === 3)).toBe(true); // 1133, 1217, 1259 form one cluster
  });
});

describe('suggestSplit', () => {
  it('returns null for missing sector', () => {
    expect(suggestSplit(sampleLayout, 'Foo', 50)).toBeNull();
  });
  it('counts clusters at given threshold', () => {
    const r = suggestSplit(sampleLayout, 'Sektor A', 50);
    expect(r?.count).toBe(1);
    expect(r?.clusters[0]!.seatCount).toBe(5);
  });
});

describe('splitSectorBySpatial', () => {
  it('returns layout unchanged when only 1 cluster', () => {
    const r = splitSectorBySpatial(sampleLayout, 'Sektor A', 50);
    expect(r.sectors).toHaveLength(1);
    expect(r.sectors[0]!.name).toBe('Sektor A');
  });

  it('splits 3-balcony layout into 3 sectors with custom names', () => {
    const layout: Layout = {
      viewBox: '0 0 2000 2000',
      sectors: [{
        name: 'Balkon',
        color: '#E95066',
        rows: [
          // Left + right interleaved (parser merged them)
          { label: 'A', seats: [
            { num: '1', x: 330, y: 100 }, { num: '2', x: 1850, y: 100 },
          ]},
          { label: 'B', seats: [
            { num: '1', x: 330, y: 150 }, { num: '2', x: 1850, y: 150 },
          ]},
          // Center balcony
          { label: 'C', seats: [
            { num: '1', x: 700, y: 1700 }, { num: '2', x: 750, y: 1700 }, { num: '3', x: 800, y: 1700 },
          ]},
        ],
      }],
    };
    const result = splitSectorBySpatial(layout, 'Balkon', 80, {
      names: ['Balkon střed', 'Balkon vlevo', 'Balkon vpravo'],
    });
    expect(result.sectors).toHaveLength(3);
    // Largest cluster first by seat count (3 center seats > 2 each side)
    expect(result.sectors[0]!.name).toBe('Balkon střed');
    expect(result.sectors[0]!.rows[0]!.seats).toHaveLength(3);
    // Each side balcony has 2 seats (its own row)
    const sides = [result.sectors[1]!, result.sectors[2]!];
    for (const s of sides) {
      const total = s.rows.reduce((a, r) => a + r.seats.length, 0);
      expect(total).toBe(2);
    }
  });

  it('preserves color across split sectors', () => {
    const layout: Layout = {
      viewBox: '0 0 2000 2000',
      sectors: [{
        name: 'Balkon',
        color: '#FF00FF',
        rows: [
          { label: '1', seats: [{ num: '1', x: 0, y: 0 }] },
          { label: '2', seats: [{ num: '1', x: 1000, y: 0 }] },
        ],
      }],
    };
    const r = splitSectorBySpatial(layout, 'Balkon', 50);
    expect(r.sectors).toHaveLength(2);
    expect(r.sectors.every((s) => s.color === '#FF00FF')).toBe(true);
  });
});

describe('flattenSector', () => {
  const colLayout: Layout = {
    viewBox: '0 0 100 1000',
    sectors: [{
      name: 'Balkon vlevo',
      color: '#ff0000',
      rows: [
        { label: 'A', seats: [{ num: '1', x: 50, y: 100 }] },
        { label: 'B', seats: [{ num: '2', x: 50, y: 200 }] },
        { label: 'C', seats: [{ num: '3', x: 50, y: 300 }] },
      ],
    }],
  };

  it('collapses all rows into a single row sorted by Y', () => {
    const r = flattenSector(colLayout, 'Balkon vlevo');
    expect(r.sectors[0]!.rows).toHaveLength(1);
    expect(r.sectors[0]!.rows[0]!.seats).toHaveLength(3);
    expect(r.sectors[0]!.rows[0]!.seats.map((s) => s.y)).toEqual([100, 200, 300]);
  });

  it('default rowLabel is empty string (hides label in UI)', () => {
    const r = flattenSector(colLayout, 'Balkon vlevo');
    expect(r.sectors[0]!.rows[0]!.label).toBe('');
  });

  it('renumberSeats option assigns 1-N sequentially', () => {
    const r = flattenSector(colLayout, 'Balkon vlevo', { renumberSeats: true });
    const seats = r.sectors[0]!.rows[0]!.seats;
    expect(seats.map((s) => s.num)).toEqual(['1', '2', '3']);
  });

  it('preserves original seat numbers when renumberSeats=false', () => {
    const r = flattenSector(colLayout, 'Balkon vlevo', { renumberSeats: false });
    const seats = r.sectors[0]!.rows[0]!.seats;
    expect(seats.map((s) => s.num)).toEqual(['1', '2', '3']); // original happen to be 1,2,3
  });

  it('handles unsorted Y input correctly', () => {
    const layout: Layout = {
      viewBox: '0 0 100 1000',
      sectors: [{
        name: 'X',
        rows: [
          { label: 'A', seats: [{ num: '5', x: 0, y: 500 }] },
          { label: 'B', seats: [{ num: '1', x: 0, y: 100 }] },
          { label: 'C', seats: [{ num: '3', x: 0, y: 300 }] },
        ],
      }],
    };
    const r = flattenSector(layout, 'X', { renumberSeats: true });
    const seats = r.sectors[0]!.rows[0]!.seats;
    // Sorted by Y: 100, 300, 500 → renumbered 1, 2, 3
    expect(seats.map((s) => s.y)).toEqual([100, 300, 500]);
    expect(seats.map((s) => s.num)).toEqual(['1', '2', '3']);
  });

  it('does nothing if sector not found', () => {
    const r = flattenSector(colLayout, 'Foo');
    expect(r.sectors[0]!.rows).toHaveLength(3);
  });
});

describe('setStage', () => {
  it('adds stage to layout', () => {
    const r = setStage(sampleLayout, { position: 'top', label: 'PODIUM' });
    expect(r.stage).toEqual({ position: 'top', label: 'PODIUM' });
  });
  it('removes stage when null passed', () => {
    const withStage = setStage(sampleLayout, { position: 'top', label: 'X' });
    const removed = setStage(withStage, null);
    expect(removed.stage).toBeUndefined();
  });
  it('does not mutate input', () => {
    const before = { ...sampleLayout };
    setStage(sampleLayout, { position: 'bottom', label: 'X' });
    expect(sampleLayout).toEqual(before);
  });
});

describe('analyzeForSuggestions', () => {
  it('detects alpha rows and suggests numeric', () => {
    const suggestions = analyzeForSuggestions(sampleLayout);
    const alphaRule = suggestions.find((s) => s.kind === 'alpha-rows');
    expect(alphaRule).toBeDefined();
    expect(alphaRule?.sectorName).toBe('Sektor A');
    expect(alphaRule?.op.type).toBe('renumber');
  });

  it('detects splittable sector', () => {
    const layout: Layout = {
      viewBox: '0 0 2000 2000',
      sectors: [{
        name: 'Mixed',
        rows: [
          { label: '1', seats: [
            { num: '1', x: 0, y: 0 }, { num: '2', x: 30, y: 0 },
            { num: '3', x: 1000, y: 0 }, { num: '4', x: 1030, y: 0 },
          ]},
        ],
      }],
    };
    const suggestions = analyzeForSuggestions(layout);
    const split = suggestions.find((s) => s.kind === 'splittable-sector');
    expect(split).toBeDefined();
    expect(split?.op.type).toBe('split');
  });

  it('detects column-sector (many rows × ≤2 seats per row)', () => {
    const layout: Layout = {
      viewBox: '0 0 100 1000',
      sectors: [{
        name: 'Balkon vlevo',
        rows: Array.from({ length: 8 }, (_, i) => ({
          label: String(i + 1),
          seats: [{ num: '1', x: 50, y: 100 + i * 50 }],
        })),
      }],
    };
    const suggestions = analyzeForSuggestions(layout);
    const col = suggestions.find((s) => s.kind === 'column-sector');
    expect(col).toBeDefined();
    expect(col?.op.type).toBe('flatten');
  });

  it('does not suggest split for clean rectangular grid', () => {
    const layout: Layout = {
      viewBox: '0 0 100 100',
      sectors: [{
        name: 'Grid',
        rows: [
          { label: '1', seats: [
            { num: '1', x: 10, y: 10 }, { num: '2', x: 30, y: 10 }, { num: '3', x: 50, y: 10 },
          ]},
          { label: '2', seats: [
            { num: '1', x: 10, y: 30 }, { num: '2', x: 30, y: 30 }, { num: '3', x: 50, y: 30 },
          ]},
        ],
      }],
    };
    const suggestions = analyzeForSuggestions(layout);
    expect(suggestions.find((s) => s.kind === 'splittable-sector')).toBeUndefined();
  });
});
