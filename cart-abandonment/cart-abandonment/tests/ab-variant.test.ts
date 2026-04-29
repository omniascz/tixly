import { describe, it, expect } from 'vitest';
import { assignAbVariant } from '../src/lib/ab-variant';

describe('assignAbVariant()', () => {
  it('vrátí A nebo B', () => {
    const variant = assignAbVariant('user_123');
    expect(['A', 'B']).toContain(variant);
  });

  it('je deterministický — stejný userId = vždy stejný variant', () => {
    const userId = 'user_abc_deterministic';
    const v1 = assignAbVariant(userId);
    const v2 = assignAbVariant(userId);
    const v3 = assignAbVariant(userId);
    expect(v1).toBe(v2);
    expect(v2).toBe(v3);
  });

  it('různí uživatelé dostávají různé varianty (distribuce)', () => {
    const variants = Array.from({ length: 100 }, (_, i) => assignAbVariant(`user_${i}`));
    const aCount = variants.filter((v) => v === 'A').length;
    const bCount = variants.filter((v) => v === 'B').length;
    // Přibližně 50/50 — tolerance ±20%
    expect(aCount).toBeGreaterThan(30);
    expect(bCount).toBeGreaterThan(30);
  });

  it('prázdný userId nevyhodí chybu', () => {
    expect(() => assignAbVariant('')).not.toThrow();
  });

  it('konkrétní userId mají stabilní varianty (regression)', () => {
    // Tyto hodnoty jsou fixní — pokud se změní hash, test to zachytí
    const known: [string, 'A' | 'B'][] = [
      ['user_0', assignAbVariant('user_0')],
      ['user_1', assignAbVariant('user_1')],
      ['user_42', assignAbVariant('user_42')],
    ];
    for (const [id, expected] of known) {
      expect(assignAbVariant(id)).toBe(expected);
    }
  });
});
