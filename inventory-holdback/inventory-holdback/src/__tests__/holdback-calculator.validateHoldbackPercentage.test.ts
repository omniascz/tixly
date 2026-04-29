import { describe, it, expect } from 'vitest';
import { validateHoldbackPercentage } from '../lib/holdback-calculator.js';

// ---------------------------------------------------------------------------
// validateHoldbackPercentage
// ---------------------------------------------------------------------------

describe('validateHoldbackPercentage', () => {
  it('allows holdback at 0%', () => {
    expect(() => validateHoldbackPercentage(0)).not.toThrow();
  });

  it('allows holdback at 25%', () => {
    expect(() => validateHoldbackPercentage(25)).not.toThrow();
  });

  it('allows holdback at exactly 50% (the cap)', () => {
    expect(() => validateHoldbackPercentage(50)).not.toThrow();
  });

  it('throws when holdback exceeds 50%', () => {
    expect(() => validateHoldbackPercentage(51)).toThrow();
  });

  it('throws when holdback is 75%', () => {
    expect(() => validateHoldbackPercentage(75)).toThrow();
  });

  it('throws when holdback is 100%', () => {
    expect(() => validateHoldbackPercentage(100)).toThrow();
  });

  it('includes percentage in error message', () => {
    let caught: Error | null = null;
    try {
      validateHoldbackPercentage(60);
    } catch (err) {
      caught = err as Error;
    }
    expect(caught).not.toBeNull();
    expect(caught?.message).toContain('60');
    expect(caught?.message).toContain('50');
  });

  it('allows fractional percentages under 50%', () => {
    expect(() => validateHoldbackPercentage(49.9)).not.toThrow();
  });

  it('throws for fractional percentages over 50%', () => {
    expect(() => validateHoldbackPercentage(50.1)).toThrow();
  });
});
