import { describe, it, expect } from 'vitest';
import { seatNumCompare, inSeatRange } from './seat-range';

describe('seatNumCompare', () => {
  it('řadí číselná místa číselně, ne abecedně', () => {
    expect(seatNumCompare('2', '10')).toBeLessThan(0);
    expect(seatNumCompare('10', '2')).toBeGreaterThan(0);
    expect(seatNumCompare('7', '7')).toBe(0);
  });

  it('nečíselná místa řadí abecedně', () => {
    expect(seatNumCompare('12A', '12B')).toBeLessThan(0);
    expect(seatNumCompare('B', 'A')).toBeGreaterThan(0);
  });
});

describe('inSeatRange', () => {
  it('bere oba kraje včetně', () => {
    expect(inSeatRange('2', '2', '10')).toBe(true);
    expect(inSeatRange('10', '2', '10')).toBe(true);
  });

  it('vyloučí místa mimo rozsah', () => {
    expect(inSeatRange('1', '2', '10')).toBe(false);
    expect(inSeatRange('11', '2', '10')).toBe(false);
  });

  it('rozsah 2–10 vezme všech devět míst, ne dvě', () => {
    const row = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'];
    const hit = row.filter((n) => inSeatRange(n, '2', '10'));
    expect(hit).toEqual(['2', '3', '4', '5', '6', '7', '8', '9', '10']);
  });

  it('nezadaná hranice neomezuje', () => {
    expect(inSeatRange('99', undefined, undefined)).toBe(true);
    expect(inSeatRange('99', '50', undefined)).toBe(true);
    expect(inSeatRange('49', '50', undefined)).toBe(false);
    expect(inSeatRange('49', undefined, '50')).toBe(true);
  });

  it('prázdný řetězec se chová jako nezadaná hranice', () => {
    expect(inSeatRange('5', '', '')).toBe(true);
  });

  it('zvládne řadu s písmennými místy', () => {
    const row = ['12A', '12B', '12C'];
    expect(row.filter((n) => inSeatRange(n, '12A', '12B'))).toEqual(['12A', '12B']);
  });
});
