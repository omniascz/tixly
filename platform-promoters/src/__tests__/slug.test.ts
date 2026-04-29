import { describe, it, expect, vi } from 'vitest';
import { normalizeSlug, generateUniqueSlug } from '../lib/slug.js';
import type { DbAdapter } from '../lib/service-container.js';

describe('normalizeSlug', () => {
  it('converts "Hudební Festival Praha" to "hudebni-festival-praha"', () => {
    expect(normalizeSlug('Hudební Festival Praha')).toBe('hudebni-festival-praha');
  });

  it('converts "Hello World!!!" to "hello-world"', () => {
    expect(normalizeSlug('Hello World!!!')).toBe('hello-world');
  });

  it('handles full Czech diacritics: á é í ó ú ů ž š č ř ď ť ň', () => {
    // á→a, é→e, í→i, ó→o, ú→u, ů→u (ring strips to u), ž→z, š→s, č→c
    expect(normalizeSlug('áéíóúůžšč')).toBe('aeiouuzsc');
    expect(normalizeSlug('řďťň')).toBe('rdtn');
  });

  it('collapses multiple dashes to one', () => {
    expect(normalizeSlug('foo---bar')).toBe('foo-bar');
    expect(normalizeSlug('foo  bar')).toBe('foo-bar');
  });

  it('trims leading and trailing dashes', () => {
    expect(normalizeSlug('---hello---')).toBe('hello');
    expect(normalizeSlug('  hello  ')).toBe('hello');
  });

  it('truncates to max 100 characters', () => {
    const longName = 'A'.repeat(200);
    const slug = normalizeSlug(longName);
    expect(slug.length).toBeLessThanOrEqual(100);
  });

  it('returns "promoter" fallback for empty or special-only input', () => {
    expect(normalizeSlug('')).toBe('promoter');
    expect(normalizeSlug('!!!###')).toBe('promoter');
  });

  it('converts mixed case with numbers', () => {
    expect(normalizeSlug('Rock Festival 2025')).toBe('rock-festival-2025');
  });
});

describe('generateUniqueSlug', () => {
  function makeDb(existingSlugs: string[]): DbAdapter {
    return {
      query: vi.fn().mockResolvedValue(existingSlugs.map((s) => ({ slug: s }))),
      execute: vi.fn().mockResolvedValue(undefined),
      transaction: vi.fn(),
    };
  }

  it('returns base slug when no conflict', async () => {
    const db = makeDb([]);
    const slug = await generateUniqueSlug('Hudební Festival Praha', db);
    expect(slug).toBe('hudebni-festival-praha');
  });

  it('appends -2 on first conflict', async () => {
    const db = makeDb(['hudebni-festival-praha']);
    const slug = await generateUniqueSlug('Hudební Festival Praha', db);
    expect(slug).toBe('hudebni-festival-praha-2');
  });

  it('appends -3 when -2 is also taken', async () => {
    const db = makeDb(['hudebni-festival-praha', 'hudebni-festival-praha-2']);
    const slug = await generateUniqueSlug('Hudební Festival Praha', db);
    expect(slug).toBe('hudebni-festival-praha-3');
  });

  it('handles empty name with fallback', async () => {
    const db = makeDb([]);
    const slug = await generateUniqueSlug('!!!', db);
    expect(slug).toBe('promoter');
  });
});
