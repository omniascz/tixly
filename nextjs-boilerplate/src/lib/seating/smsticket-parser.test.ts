import { describe, it, expect } from 'vitest';
import { isSmsTicketSvg, parseSmsTicketSvg, applySectorRenames } from './smsticket-parser';

const SAMPLE = `<svg width="923" height="641"><g transform="scale(0.34) translate(0, 0)">
<image x="0" y="0" width="1510" height="1880" preserveAspectRatio="xMinYMin slice" xlink:href="https://example.test/bg.svg"></image>
<path d="M 100,200 m -16,0 a 16,16 0 1,0 32,0 a 16,16 0 1,0 -32,0" data-code="s1" fill="#F7E607" class="jvectormap-region"></path>
<path d="M 130,200 m -16,0 a 16,16 0 1,0 32,0 a 16,16 0 1,0 -32,0" data-code="s2" fill="#F7E607" class="jvectormap-region"></path>
<path d="M 100,240 m -16,0 a 16,16 0 1,0 32,0 a 16,16 0 1,0 -32,0" data-code="s3" fill="#F7E607" class="jvectormap-region"></path>
<path d="M 500,400 m -16,0 a 16,16 0 1,0 32,0 a 16,16 0 1,0 -32,0" data-code="s4" fill="#14B214" class="jvectormap-region"></path>
<path d="M 530,400 m -16,0 a 16,16 0 1,0 32,0 a 16,16 0 1,0 -32,0" data-code="s5" fill="#14B214" class="jvectormap-region"></path>
<text data-parent-code="s1"><tspan>2</tspan></text>
<text data-parent-code="s2"><tspan>1</tspan></text>
<text data-parent-code="s3"><tspan>2</tspan></text>
<text data-parent-code="s4"><tspan>2</tspan></text>
<text data-parent-code="s5"><tspan>1</tspan></text>
<path data-code="s1o" data-parent-code="s1" fill-opacity="0" d="..."></path>
</g></svg>`;

describe('isSmsTicketSvg', () => {
  it('detects jvectormap-region marker', () => {
    expect(isSmsTicketSvg(SAMPLE)).toBe(true);
  });
  it('detects data-code="sNNN" pattern even without jvectormap class', () => {
    expect(isSmsTicketSvg('<svg><path d="M 1,2" data-code="s42" fill="#000000"/></svg>')).toBe(true);
  });
  it('returns false for ordinary SVG', () => {
    expect(isSmsTicketSvg('<svg><circle cx="1" cy="2" r="3"/></svg>')).toBe(false);
  });
});

describe('parseSmsTicketSvg', () => {
  it('extracts seats grouped by color', () => {
    const r = parseSmsTicketSvg(SAMPLE);
    expect(r.layout.sectors).toHaveLength(2);
    // Largest sector first — but here yellow has 3 seats, green has 2 → yellow wins.
    expect(r.layout.sectors[0]!.name).toBe('#F7E607');
    expect(r.layout.sectors[1]!.name).toBe('#14B214');
  });

  it('clusters seats by Y into numerically-labeled rows (1, 2, 3...)', () => {
    const r = parseSmsTicketSvg(SAMPLE);
    const yellow = r.layout.sectors[0]!;
    expect(yellow.rows).toHaveLength(2); // y=200 and y=240
    expect(yellow.rows[0]!.label).toBe('1');
    expect(yellow.rows[1]!.label).toBe('2');
    expect(yellow.rows[0]!.seats).toHaveLength(2);
  });

  it('reads seat numbers from <text data-parent-code>', () => {
    const r = parseSmsTicketSvg(SAMPLE);
    const yellow = r.layout.sectors[0]!;
    // Seats sorted left-to-right by X. s2 is at x=130 with num=1, s1 is at x=100 with num=2.
    // After sort by X ascending: x=100 first (num=2), x=130 second (num=1).
    expect(yellow.rows[0]!.seats[0]!.num).toBe('2');
    expect(yellow.rows[0]!.seats[1]!.num).toBe('1');
  });

  it('extracts viewBox from background image dimensions', () => {
    const r = parseSmsTicketSvg(SAMPLE);
    expect(r.layout.viewBox).toBe('0 0 1510 1880');
  });

  it('returns backgroundUrl for floor plan storage', () => {
    const r = parseSmsTicketSvg(SAMPLE);
    expect(r.backgroundUrl).toBe('https://example.test/bg.svg');
  });

  it('skips overlay paths (data-code ending in "o")', () => {
    const r = parseSmsTicketSvg(SAMPLE);
    let total = 0;
    for (const s of r.layout.sectors) for (const row of s.rows) total += row.seats.length;
    expect(total).toBe(5); // 5 paths, overlay (s1o) excluded
  });

  it('throws on SVG with no seat paths', () => {
    expect(() => parseSmsTicketSvg('<svg><rect x="0" y="0" width="10" height="10"/></svg>')).toThrow(/seat-paths/);
  });

  it('parses cubic-bezier circle paths (smsticket side balcony format)', () => {
    // Cubic-bezier circle: M point at right edge (cx+16), curve goes around → center at M.x - 16
    const svg = `<svg viewBox="0 0 2000 2000">
      <image x="0" y="0" width="2000" height="2000" xlink:href="https://example/bg.svg"/>
      <path d="M1872.82812,802.953125 C1872.82812,811.78 1865.66,818.95 1856.83,818.95 C1847.99,818.95 1840.83,811.78 1840.83,802.95 C1840.83,794.11 1847.99,786.95 1856.83,786.95 C1865.66,786.95 1872.83,794.11 1872.83,802.95 Z" data-code="s100" fill="#E95066"></path>
      <path d="M1872.82812,849.953125 C1872.82812,858.78 1865.66,865.95 1856.83,865.95 C1847.99,865.95 1840.83,858.78 1840.83,849.95 C1840.83,841.11 1847.99,833.95 1856.83,833.95 C1865.66,833.95 1872.83,841.11 1872.83,849.95 Z" data-code="s101" fill="#E95066"></path>
      <text data-parent-code="s100" x="1856.83" y="807.95"><tspan>1</tspan></text>
      <text data-parent-code="s101" x="1856.83" y="854.95"><tspan>2</tspan></text>
    </svg>`;
    const r = parseSmsTicketSvg(svg);
    expect(r.layout.sectors).toHaveLength(1);
    const seats = r.layout.sectors[0]!.rows.flatMap((row) => row.seats);
    expect(seats).toHaveLength(2);
    // Center should be at M.x - 16 = 1872.83 - 16 ≈ 1857 (rounded)
    expect(seats[0]!.x).toBe(1857);
    expect(seats[0]!.num).toBe('1');
  });

  it('handles mixed arc + cubic-bezier in same SVG', () => {
    const svg = `<svg>
      <image x="0" y="0" width="1000" height="1000" xlink:href="https://example/bg.svg"/>
      <path d="M 100,200 m -16,0 a 16,16 0 1,0 32,0 a 16,16 0 1,0 -32,0" data-code="s1" fill="#FF0000"></path>
      <path d="M150,200 C150,209 143,216 134,216 C125,216 118,209 118,200 C118,191 125,184 134,184 C143,184 150,191 150,200 Z" data-code="s2" fill="#FF0000"></path>
      <text data-parent-code="s1"><tspan>A1</tspan></text>
      <text data-parent-code="s2"><tspan>A2</tspan></text>
    </svg>`;
    const r = parseSmsTicketSvg(svg);
    const seats = r.layout.sectors[0]!.rows.flatMap((row) => row.seats);
    expect(seats).toHaveLength(2);
    // s1 arc-format: center 100,200; s2 cubic: center 150-16=134, 200
    expect(seats.find((s) => s.num === 'A1')?.x).toBe(100);
    expect(seats.find((s) => s.num === 'A2')?.x).toBe(134);
  });

  it('warns on missing seat numbers', () => {
    const noNums = SAMPLE.replace(/<text\b[\s\S]*?<\/text>/g, '');
    const r = parseSmsTicketSvg(noNums);
    expect(r.warnings.some((w) => w.includes('číselný štítek'))).toBe(true);
  });
});

describe('applySectorRenames', () => {
  it('renames sectors matching keys', () => {
    const layout = {
      viewBox: '0 0 100 100',
      sectors: [
        { name: '#F7E607', color: '#F7E607', rows: [] },
        { name: '#14B214', color: '#14B214', rows: [] },
      ],
    };
    const out = applySectorRenames(layout, {
      '#F7E607': 'Balkon - Zóna I',
      '#14B214': 'Přízemí - Zóna II',
    });
    expect(out.sectors[0]!.name).toBe('Balkon - Zóna I');
    expect(out.sectors[1]!.name).toBe('Přízemí - Zóna II');
    // Color preserved
    expect(out.sectors[0]!.color).toBe('#F7E607');
  });

  it('leaves unmapped sectors unchanged', () => {
    const layout = { viewBox: '0 0 100 100', sectors: [{ name: '#FFB800', color: '#FFB800', rows: [] }] };
    const out = applySectorRenames(layout, { '#OTHER': 'X' });
    expect(out.sectors[0]!.name).toBe('#FFB800');
  });
});
