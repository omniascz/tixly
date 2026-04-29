import { calculateSecondsRemaining } from './flash-sale-calculator';

describe('countdown math', () => {
  test('returns exact seconds until endsAt', () => {
    const now = new Date('2026-04-08T12:00:00Z');
    const endsAt = new Date('2026-04-08T12:05:00Z');
    expect(calculateSecondsRemaining(endsAt, now)).toBe(300);
  });

  test('clamps to 0 after expiry', () => {
    const now = new Date('2026-04-08T12:10:00Z');
    const endsAt = new Date('2026-04-08T12:05:00Z');
    expect(calculateSecondsRemaining(endsAt, now)).toBe(0);
  });

  test('second-precision floor', () => {
    const now = new Date('2026-04-08T12:00:00.000Z');
    const endsAt = new Date('2026-04-08T12:00:01.999Z');
    expect(calculateSecondsRemaining(endsAt, now)).toBe(1);
  });
});
