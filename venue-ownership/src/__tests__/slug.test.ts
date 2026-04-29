import { describe, it, expect, vi } from 'vitest';
import { slugify, generateUniqueVenueSlug } from '../lib/slug.js';
import type { DbAdapter } from '../lib/service-container.js';

// ---------------------------------------------------------------------------
// slugify() unit tests
// ---------------------------------------------------------------------------
describe('slugify()', () => {
  it('strips diacritics from Czech characters', () => {
    expect(slugify('Světluška')).toBe('svetluska');
  });

  it('converts "Klub Světluška Praha" correctly', () => {
    expect(slugify('Klub Světluška Praha')).toBe('klub-svetluska-praha');
  });

  it('converts spaces to hyphens', () => {
    expect(slugify('klub praha')).toBe('klub-praha');
  });

  it('lowercases the result', () => {
    expect(slugify('VELKY KLUB')).toBe('velky-klub');
  });

  it('removes special characters', () => {
    expect(slugify('Klub! (Praha) #1')).toBe('klub-praha-1');
  });

  it('truncates to max 120 characters', () => {
    const long = 'a'.repeat(200);
    expect(slugify(long).length).toBeLessThanOrEqual(120);
  });

  it('returns "venue" fallback for empty string', () => {
    expect(slugify('')).toBe('venue');
    expect(slugify('   ')).toBe('venue');
  });

  it('preserves digits in the name', () => {
    expect(slugify('Studio 54 Praha')).toBe('studio-54-praha');
  });

  it('collapses multiple spaces to single hyphen', () => {
    expect(slugify('klub   praha')).toBe('klub-praha');
  });

  it('strips leading and trailing hyphens', () => {
    expect(slugify('---klub---')).toBe('klub');
  });

  it('handles full diacritic set: áéíóúýčďěňřšťůž', () => {
    // á→a, é→e, í→i, ó→o, ú→u, ý→y, č→c, ď→d, ě→e, ň→n, ř→r, š→s, ť→t, ů→u, ž→z
    expect(slugify('áéíóúýčďěňřšťůž')).toBe('aeiouycdenrstuz');
    const result = slugify('Čáp žába');
    expect(result).toBe('cap-zaba');
  });
});

// ---------------------------------------------------------------------------
// generateUniqueVenueSlug() tests (with mock DbAdapter)
// ---------------------------------------------------------------------------

function makeDb(existingSlugs: string[]): DbAdapter {
  return {
    query: vi.fn().mockImplementation(async (_sql: string, params: unknown[]) => {
      const pattern = (params[0] as string).replace('%', '');
      return existingSlugs
        .filter((s) => s.startsWith(pattern))
        .map((s) => ({ slug: s }));
    }),
    execute: vi.fn(),
    transaction: vi.fn(),
  };
}

describe('generateUniqueVenueSlug()', () => {
  it('returns base slug when no conflicts exist', async () => {
    const db = makeDb([]);
    const slug = await generateUniqueVenueSlug('Klub Praha', db);
    expect(slug).toBe('klub-praha');
  });

  it('returns slug-2 when base slug is taken', async () => {
    const db = makeDb(['klub-praha']);
    const slug = await generateUniqueVenueSlug('Klub Praha', db);
    expect(slug).toBe('klub-praha-2');
  });

  it('returns slug-3 when slug and slug-2 are taken', async () => {
    const db = makeDb(['klub-praha', 'klub-praha-2']);
    const slug = await generateUniqueVenueSlug('Klub Praha', db);
    expect(slug).toBe('klub-praha-3');
  });

  it('handles empty name with fallback "venue"', async () => {
    const db = makeDb([]);
    const slug = await generateUniqueVenueSlug('', db);
    expect(slug).toBe('venue');
  });

  it('handles name that produces slug already at max length', async () => {
    const longName = 'a'.repeat(150);
    const db = makeDb([]);
    const slug = await generateUniqueVenueSlug(longName, db);
    expect(slug.length).toBeLessThanOrEqual(120);
  });

  it('queries DB with LIKE pattern based on base slug', async () => {
    const db = makeDb([]);
    await generateUniqueVenueSlug('Test Venue', db);
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('LIKE'),
      expect.arrayContaining([expect.stringContaining('test-venue')]),
    );
  });
});
