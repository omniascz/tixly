import { describe, it, expect } from 'vitest';
import { calculateAgeYears } from './calculate';

describe('calculateAgeYears', () => {
  it('returns 18 on 18th birthday', () => {
    expect(
      calculateAgeYears('2008-04-26', new Date('2026-04-26T12:00:00Z')),
    ).toBe(18);
  });

  it('returns 17 the day before 18th birthday', () => {
    expect(
      calculateAgeYears('2008-04-26', new Date('2026-04-25T23:59:00Z')),
    ).toBe(17);
  });

  it('returns 18 the day after 18th birthday', () => {
    expect(
      calculateAgeYears('2008-04-26', new Date('2026-04-27T12:00:00Z')),
    ).toBe(18);
  });

  it('handles different month before birthday', () => {
    expect(
      calculateAgeYears('2008-12-31', new Date('2026-06-15T00:00:00Z')),
    ).toBe(17);
  });

  it('handles different month after birthday', () => {
    expect(
      calculateAgeYears('2008-01-15', new Date('2026-06-15T00:00:00Z')),
    ).toBe(18);
  });

  it('returns NaN for malformed string', () => {
    expect(calculateAgeYears('not-a-date', new Date('2026-04-26'))).toBeNaN();
  });

  it('returns NaN for partially valid string', () => {
    expect(calculateAgeYears('2008-04', new Date('2026-04-26'))).toBeNaN();
  });

  it('returns 0 for birthDate today', () => {
    expect(
      calculateAgeYears('2026-04-26', new Date('2026-04-26T12:00:00Z')),
    ).toBe(0);
  });

  it('returns negative for future birthDate', () => {
    expect(
      calculateAgeYears('2030-01-01', new Date('2026-04-26T12:00:00Z')),
    ).toBe(-4);
  });

  it('handles leap year birthday (29.2.) on non-leap year', () => {
    // Born 29.2.2000, on 28.2.2026 → age 25 (birthday hasn't occurred yet)
    expect(
      calculateAgeYears('2000-02-29', new Date('2026-02-28T12:00:00Z')),
    ).toBe(25);
    // On 1.3.2026 → age 26 (birthday has passed)
    expect(
      calculateAgeYears('2000-02-29', new Date('2026-03-01T12:00:00Z')),
    ).toBe(26);
  });

  it('handles exactly 100 years', () => {
    expect(
      calculateAgeYears('1926-04-26', new Date('2026-04-26T12:00:00Z')),
    ).toBe(100);
  });
});
