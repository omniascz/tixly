import { describe, it, expect } from 'vitest';
import { HoldbackCategory } from '../types/holdback.types.js';

// ---------------------------------------------------------------------------
// HoldbackCategory enum tests
// ---------------------------------------------------------------------------

describe('HoldbackCategory', () => {
  it('defines sponsor category', () => {
    expect(HoldbackCategory.Sponsor).toBe('sponsor');
  });

  it('defines press category', () => {
    expect(HoldbackCategory.Press).toBe('press');
  });

  it('defines last_minute category', () => {
    expect(HoldbackCategory.LastMinute).toBe('last_minute');
  });

  it('defines vip category', () => {
    expect(HoldbackCategory.VIP).toBe('vip');
  });

  it('all categories are enumerable', () => {
    const categories = Object.values(HoldbackCategory);
    expect(categories.length).toBe(4);
    expect(categories).toContain('sponsor');
    expect(categories).toContain('press');
    expect(categories).toContain('last_minute');
    expect(categories).toContain('vip');
  });
});
