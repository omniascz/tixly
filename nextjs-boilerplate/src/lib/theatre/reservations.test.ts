import { describe, expect, it } from 'vitest';
import { assertReservable, generateReservationCode, reservationDeadline, ReservationError } from './reservations';

const now = new Date('2026-11-01T10:00:00.000Z');
const h = 3_600_000;

describe('lhůta rezervace (kolo 8 / krok 5)', () => {
  it('N dní od vytvoření, když je začátek daleko', () => {
    expect(reservationDeadline(now, new Date(now.getTime() + 30 * 24 * h), 5, 2)?.toISOString()).toBe('2026-11-06T10:00:00.000Z');
  });
  it('nejpozději M hodin před začátkem', () => {
    expect(reservationDeadline(now, new Date(now.getTime() + 30 * h), 5, 2)?.toISOString()).toBe('2026-11-02T14:00:00.000Z');
  });
  it('méně než M hodin před začátkem už nelze', () => {
    expect(reservationDeadline(now, new Date(now.getTime() + 90 * 60_000), 5, 2)).toBeNull();
  });
  it('assertReservable: vypnuté / uzavřené rezervace hlásí kód', () => {
    const ev = { reservations_enabled: false, reservation_days: 5, reservation_cutoff_hours: 2, date_start: new Date(now.getTime() + 48 * h) };
    expect(() => assertReservable(ev, now)).toThrow(ReservationError);
    try { assertReservable({ ...ev, reservations_enabled: true, date_start: new Date(now.getTime() + h) }, now); } catch (e) {
      expect((e as ReservationError).code).toBe('RESERVATION_CLOSED');
    }
  });
  it('kód rezervace: 8 znaků bez zaměnitelných (0/O, 1/I)', () => {
    for (let i = 0; i < 200; i++) expect(generateReservationCode()).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
  });
});
