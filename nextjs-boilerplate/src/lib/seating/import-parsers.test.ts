import { describe, it, expect } from 'vitest';
import { parseCsv, parseJson, parseSvg, detectFormat } from './import-parsers';

describe('detectFormat', () => {
  it('uses extension when available', () => {
    expect(detectFormat('foo,bar', 'a.csv')).toBe('csv');
    expect(detectFormat('<svg/>', 'a.svg')).toBe('svg');
    expect(detectFormat('{}', 'a.json')).toBe('json');
  });
  it('falls back to content sniffing', () => {
    expect(detectFormat('<svg xmlns="..."/>')).toBe('svg');
    expect(detectFormat('{"sectors":[]}')).toBe('json');
    expect(detectFormat('sector,row,num,x,y\n"A","1","1",0,0')).toBe('csv');
  });
  it('returns null for unrecognizable content', () => {
    expect(detectFormat('hello world')).toBeNull();
  });
});

describe('parseCsv', () => {
  it('parses minimal valid CSV', () => {
    const csv = `sector,row,num,x,y
"Tribuna A","A","1",100,200
"Tribuna A","A","2",130,200
"Tribuna A","B","1",100,230`;
    const r = parseCsv(csv);
    expect(r.layout.sectors).toHaveLength(1);
    expect(r.layout.sectors[0]!.name).toBe('Tribuna A');
    expect(r.layout.sectors[0]!.rows).toHaveLength(2);
    expect(r.layout.sectors[0]!.rows[0]!.seats).toHaveLength(2);
  });

  it('groups multiple sectors with distinct colors', () => {
    const csv = `sector,row,num,x,y
"A","A","1",0,0
"B","A","1",100,0`;
    const r = parseCsv(csv);
    expect(r.layout.sectors).toHaveLength(2);
    expect(r.layout.sectors[0]!.color).not.toBe(r.layout.sectors[1]!.color);
  });

  it('respects accessibility column', () => {
    const csv = `sector,row,num,x,y,accessibility
"A","A","1",0,0,true
"A","A","2",10,0,false`;
    const r = parseCsv(csv);
    const seats = r.layout.sectors[0]!.rows[0]!.seats;
    expect(seats[0]!.accessibility).toBe(true);
    expect(seats[1]!.accessibility).toBeUndefined();
  });

  it('throws on missing required columns', () => {
    expect(() => parseCsv('sector,row,num\nA,A,1')).toThrow(/povinný sloupec/);
  });

  it('warns on invalid rows but continues', () => {
    const csv = `sector,row,num,x,y
"A","A","1",abc,0
"A","A","2",10,20`;
    const r = parseCsv(csv);
    expect(r.warnings.length).toBeGreaterThan(0);
    expect(r.layout.sectors[0]!.rows[0]!.seats).toHaveLength(1);
  });
});

describe('parseJson', () => {
  it('passes through valid layout', () => {
    const json = JSON.stringify({
      viewBox: '0 0 1000 800',
      sectors: [{
        name: 'Tribuna',
        color: '#3b82f6',
        rows: [{ label: 'A', seats: [{ num: '1', x: 10, y: 20 }] }],
      }],
    });
    const r = parseJson(json);
    expect(r.layout.viewBox).toBe('0 0 1000 800');
    expect(r.layout.sectors[0]!.color).toBe('#3b82f6');
  });

  it('assigns default color when missing', () => {
    const json = JSON.stringify({
      sectors: [{ name: 'X', rows: [{ label: 'A', seats: [{ num: '1', x: 0, y: 0 }] }] }],
    });
    const r = parseJson(json);
    expect(r.layout.sectors[0]!.color).toMatch(/^#[0-9a-fA-F]{6}$/);
  });

  it('throws on malformed JSON', () => {
    expect(() => parseJson('{not json')).toThrow(/JSON/);
  });

  it('throws when no sectors with seats', () => {
    expect(() => parseJson('{"sectors":[]}')).toThrow(/žádné platné sektory/);
  });
});

describe('parseSvg', () => {
  it('parses circles with data-* metadata', () => {
    const svg = `<svg viewBox="0 0 1000 800">
      <circle cx="100" cy="200" r="6" data-sector="A" data-row="A" data-num="1" />
      <circle cx="130" cy="200" r="6" data-sector="A" data-row="A" data-num="2" />
    </svg>`;
    const r = parseSvg(svg);
    expect(r.layout.viewBox).toBe('0 0 1000 800');
    expect(r.layout.sectors).toHaveLength(1);
    expect(r.layout.sectors[0]!.rows[0]!.seats).toHaveLength(2);
  });

  it('groups circles heuristically by fill color when no metadata', () => {
    const svg = `<svg viewBox="0 0 1000 800">
      <circle cx="10" cy="10" fill="#3b82f6"/>
      <circle cx="20" cy="10" fill="#3b82f6"/>
      <circle cx="100" cy="10" fill="#f59e0b"/>
    </svg>`;
    const r = parseSvg(svg);
    expect(r.layout.sectors).toHaveLength(2);
    expect(r.warnings.some((w) => w.includes('heuristicky'))).toBe(true);
  });

  it('parses rects using their center', () => {
    const svg = `<svg viewBox="0 0 1000 800">
      <rect x="100" y="200" width="20" height="20" data-sector="A" data-row="A" data-num="1"/>
    </svg>`;
    const r = parseSvg(svg);
    const seat = r.layout.sectors[0]!.rows[0]!.seats[0]!;
    expect(seat.x).toBe(110);
    expect(seat.y).toBe(210);
  });

  it('uses width/height attrs when viewBox missing', () => {
    const svg = `<svg width="500" height="400"><circle cx="10" cy="10"/></svg>`;
    const r = parseSvg(svg);
    expect(r.layout.viewBox).toBe('0 0 500 400');
  });

  it('throws when no shapes found', () => {
    expect(() => parseSvg('<svg viewBox="0 0 100 100"></svg>')).toThrow(/<circle/);
  });
});
