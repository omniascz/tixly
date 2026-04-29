import { describe, it, expect } from 'vitest';
import { diffLayouts } from './diff';

const baseLayout = {
  viewBox: '0 0 1000 800',
  sectors: [
    {
      name: 'A',
      color: '#3b82f6',
      rows: [
        {
          label: '1',
          seats: [
            { num: '1', x: 10, y: 10 },
            { num: '2', x: 20, y: 10 },
          ],
        },
      ],
    },
  ],
};

describe('diffLayouts', () => {
  it('reports identical when layouts match', () => {
    const r = diffLayouts(baseLayout, baseLayout);
    expect(r.identical).toBe(true);
    expect(r.totals.added).toBe(0);
    expect(r.totals.removed).toBe(0);
  });

  it('detects added seats', () => {
    const next = JSON.parse(JSON.stringify(baseLayout));
    next.sectors[0].rows[0].seats.push({ num: '3', x: 30, y: 10 });
    const r = diffLayouts(baseLayout, next);
    expect(r.identical).toBe(false);
    expect(r.totals.added).toBe(1);
    expect(r.totals.removed).toBe(0);
    expect(r.sample.find((s) => s.kind === 'added')?.num).toBe('3');
  });

  it('detects removed seats', () => {
    const next = JSON.parse(JSON.stringify(baseLayout));
    next.sectors[0].rows[0].seats.pop();
    const r = diffLayouts(baseLayout, next);
    expect(r.totals.removed).toBe(1);
    expect(r.totals.added).toBe(0);
  });

  it('detects moved seats', () => {
    const next = JSON.parse(JSON.stringify(baseLayout));
    next.sectors[0].rows[0].seats[0].x = 11;
    const r = diffLayouts(baseLayout, next);
    expect(r.totals.moved).toBe(1);
    expect(r.totals.added).toBe(0);
  });

  it('detects accessibility flag changes independently of position', () => {
    const next = JSON.parse(JSON.stringify(baseLayout));
    next.sectors[0].rows[0].seats[0].accessibility = true;
    const r = diffLayouts(baseLayout, next);
    expect(r.totals.accessibilityChanged).toBe(1);
    expect(r.totals.moved).toBe(0);
  });

  it('detects sector add/remove', () => {
    const next = JSON.parse(JSON.stringify(baseLayout));
    next.sectors.push({
      name: 'B',
      color: '#f59e0b',
      rows: [{ label: '1', seats: [{ num: '1', x: 100, y: 100 }] }],
    });
    const r = diffLayouts(baseLayout, next);
    expect(r.sectors.added).toEqual(['B']);
    expect(r.totals.added).toBe(1);
  });

  it('detects sector rename heuristically when seat counts match', () => {
    const next = JSON.parse(JSON.stringify(baseLayout));
    next.sectors[0].name = 'A-renamed';
    const r = diffLayouts(baseLayout, next);
    expect(r.sectors.renamed).toEqual([{ from: 'A', to: 'A-renamed' }]);
    expect(r.sectors.added).toHaveLength(0);
    expect(r.sectors.removed).toHaveLength(0);
  });

  it('reports viewBox change', () => {
    const next = { ...baseLayout, viewBox: '0 0 2000 1600' };
    const r = diffLayouts(baseLayout, next);
    expect(r.viewBoxChanged).toBe(true);
    expect(r.identical).toBe(false);
  });

  it('caps sample at 200 entries', () => {
    const big = JSON.parse(JSON.stringify(baseLayout));
    big.sectors[0].rows[0].seats = [];
    for (let i = 0; i < 500; i++) {
      big.sectors[0].rows[0].seats.push({ num: String(i), x: i, y: 0 });
    }
    const empty = { ...baseLayout, sectors: [{ ...baseLayout.sectors[0], rows: [{ label: '1', seats: [] }] }] };
    const r = diffLayouts(empty, big);
    expect(r.totals.added).toBe(500);
    expect(r.sample.length).toBeLessThanOrEqual(200);
  });
});
