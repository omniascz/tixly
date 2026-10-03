import { describe, expect, it } from 'vitest';
import { boxOfficeSalesEndsAt, isSalesOpen, onlineSalesEndsAt, validateSalesEndAt } from './cutoff';

const start = '2026-12-01T19:00:00.000Z';
const end = '2026-12-01T22:00:00.000Z';

describe('uzávěrka prodeje (kolo 7, C-29)', () => {
  it('online: bez sales_end_at končí začátkem akce, uzávěrka sama už je po prodeji', () => {
    const ev = { date_start: start, date_end: end };
    expect(onlineSalesEndsAt(ev).toISOString()).toBe(start);
    expect(isSalesOpen(ev, 'online', new Date(Date.parse(start) - 1))).toBe(true);
    expect(isSalesOpen(ev, 'online', new Date(start))).toBe(false);
  });

  it('online: sales_end_at má přednost před začátkem akce', () => {
    const ev = { date_start: start, date_end: end, sales_end_at: '2026-12-01T12:00:00.000Z' };
    expect(isSalesOpen(ev, 'online', new Date('2026-12-01T11:59:59.999Z'))).toBe(true);
    expect(isSalesOpen(ev, 'online', new Date('2026-12-01T12:00:00.000Z'))).toBe(false);
  });

  it('pokladna: do konce akce, bez konce do začátku + 12 h', () => {
    expect(boxOfficeSalesEndsAt({ date_start: start, date_end: end }).toISOString()).toBe(end);
    expect(boxOfficeSalesEndsAt({ date_start: start, date_end: null }).toISOString()).toBe('2026-12-02T07:00:00.000Z');
    expect(isSalesOpen({ date_start: start, date_end: end }, 'box_office', new Date('2026-12-01T20:00:00.000Z'))).toBe(true);
    expect(isSalesOpen({ date_start: start, date_end: end }, 'box_office', new Date(end))).toBe(false);
  });

  it('validace: po konci akce chyba, rovno konci OK, prázdné OK', () => {
    expect(validateSalesEndAt('2026-12-01T22:00:00.001Z', { date_start: start, date_end: end })).toMatch(/po konci akce/);
    expect(validateSalesEndAt(end, { date_start: start, date_end: end })).toBeNull();
    expect(validateSalesEndAt(null, { date_start: start, date_end: end })).toBeNull();
    expect(validateSalesEndAt('2026-12-02T07:00:00.001Z', { date_start: start, date_end: null })).toMatch(/12 hodin/);
  });
});
