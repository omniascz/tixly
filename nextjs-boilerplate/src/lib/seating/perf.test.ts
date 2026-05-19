import { describe, it, expect } from 'vitest';
import { diffLayouts } from './diff';
import { classifyChartSize } from './perf';

describe('classifyChartSize', () => {
  it('classifies small charts as ok', () => {
    expect(classifyChartSize(100).level).toBe('ok');
    expect(classifyChartSize(4_999).level).toBe('ok');
  });
  it('classifies medium charts', () => {
    expect(classifyChartSize(10_000).level).toBe('caution');
  });
  it('classifies arena-size charts as warning', () => {
    expect(classifyChartSize(20_000).level).toBe('warning');
    expect(classifyChartSize(59_000).level).toBe('warning');
  });
  it('classifies stadium-size charts as critical', () => {
    expect(classifyChartSize(99_000).level).toBe('critical');
    expect(classifyChartSize(100_000).level).toBe('critical');
  });
  it('always returns recommendations for non-ok levels', () => {
    expect(classifyChartSize(50_000).recommendations.length).toBeGreaterThan(0);
    expect(classifyChartSize(99_000).recommendations.length).toBeGreaterThan(0);
  });
});

describe('diffLayouts performance (Camp Nou class)', () => {
  function makeBigLayout(seatsPerRow: number, rowsPerSector: number, sectorCount: number) {
    const sectors = [];
    for (let s = 0; s < sectorCount; s++) {
      const rows = [];
      for (let r = 0; r < rowsPerSector; r++) {
        const seats = [];
        for (let n = 0; n < seatsPerRow; n++) {
          seats.push({ num: String(n + 1), x: s * 1000 + n * 30, y: r * 30 });
        }
        rows.push({ label: String.fromCharCode(65 + (r % 26)) + Math.floor(r / 26), seats });
      }
      sectors.push({ name: `Sector ${s + 1}`, color: '#3b82f6', rows });
    }
    return { viewBox: '0 0 50000 5000', sectors };
  }

  it('diffs identical 100k-seat layouts in < 2000 ms', () => {
    // 50 sectors × 50 rows × 40 seats = 100 000
    const a = makeBigLayout(40, 50, 50);
    const b = JSON.parse(JSON.stringify(a));
    const start = performance.now();
    const r = diffLayouts(a, b);
    const elapsed = performance.now() - start;
    expect(r.identical).toBe(true);
    expect(r.totals.fromSeats).toBe(100_000);
    expect(elapsed).toBeLessThan(2000);
  });

  it('diffs layouts with 1000 changes in 100k-seat dataset', () => {
    const a = makeBigLayout(40, 50, 50);
    const b = JSON.parse(JSON.stringify(a));
    // Move first 1000 seats by 1px
    let moved = 0;
    outer: for (const s of b.sectors) {
      for (const r of s.rows) {
        for (const seat of r.seats) {
          seat.x += 1;
          moved++;
          if (moved >= 1000) break outer;
        }
      }
    }
    const start = performance.now();
    const r = diffLayouts(a, b);
    const elapsed = performance.now() - start;
    expect(r.totals.moved).toBe(1000);
    expect(r.sample.length).toBeLessThanOrEqual(200);
    expect(elapsed).toBeLessThan(2000);
  });
});
