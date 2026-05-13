import type { DbAdapter } from './service-container.js';

/**
 * Converts a string to a URL-safe slug.
 * Uses NFD normalization to strip diacritics — no npm packages required.
 * "Klub Světluška Praha" → "klub-svetluska-praha"
 * Max 120 characters.
 */
export function slugify(input: string): string {
  if (!input || input.trim().length === 0) {
    return 'venue';
  }

  const slug = input
    .normalize('NFD')                   // decompose accented chars
    .replace(/[\u0300-\u036f]/g, '')    // strip combining diacritical marks
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')      // keep alphanumeric, spaces, hyphens
    .trim()
    .replace(/[\s]+/g, '-')            // spaces → hyphens
    .replace(/-{2,}/g, '-')            // collapse multiple hyphens
    .replace(/^-|-$/g, '')             // trim leading/trailing hyphens
    .slice(0, 120);

  return slug || 'venue';
}

/**
 * Generates a unique slug for a venue by querying the database.
 * If "klub-praha" is taken, tries "klub-praha-2", "klub-praha-3", etc.
 */
export async function generateUniqueVenueSlug(
  name: string,
  db: DbAdapter,
): Promise<string> {
  const base = slugify(name);

  // Check if base slug is free
  const existing = await db.query<{ slug: string }>(
    'SELECT slug FROM catalog.venues WHERE slug LIKE $1',
    [`${base}%`],
  );

  if (existing.length === 0) {
    return base;
  }

  const takenSlugs = new Set(existing.map((r) => r.slug));

  if (!takenSlugs.has(base)) {
    return base;
  }

  // Find the next available suffix number
  let counter = 2;
  // Allow up to 116 chars for base so "-NNN" fits within 120
  const truncatedBase = base.slice(0, 116);
  while (true) {
    const candidate = `${truncatedBase}-${counter}`;
    if (!takenSlugs.has(candidate)) {
      return candidate;
    }
    counter++;
    // Safety valve — should never be reached in practice
    if (counter > 9999) {
      return `${truncatedBase}-${Date.now()}`;
    }
  }
}
