import type { DbAdapter } from './service-container.js';

/**
 * Normalizuje název na slug:
 * "Hudební Festival Praha" → "hudebni-festival-praha"
 * - NFD normalizace + odstranění diakritiky
 * - Lowercase
 * - Speciální znaky a mezery → pomlčka
 * - Vícenásobné pomlčky → jedna
 * - Trim pomlček na začátku/konci
 * - Max 100 znaků
 */
export function normalizeSlug(name: string): string {
  const normalized = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')   // strip diakritika
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')       // vše mimo alfanumeriku → pomlčka
    .replace(/-{2,}/g, '-')            // vícenásobné pomlčky → jedna
    .replace(/^-+|-+$/g, '')           // trim pomlček
    .slice(0, 100);

  return normalized || 'promoter';
}

/**
 * Vygeneruje unikátní slug z názvu.
 * Pokud slug existuje → přidá -2, -3, atd.
 */
export async function generateUniqueSlug(name: string, db: DbAdapter): Promise<string> {
  const base = normalizeSlug(name);

  // Zkontroluj zda base slug existuje
  const existing = await db.query<{ slug: string }>(
    `SELECT slug FROM platform.promoters WHERE slug LIKE $1`,
    [`${base}%`],
  );

  const existingSlugs = new Set(existing.map((r) => r.slug));

  if (!existingSlugs.has(base)) {
    return base;
  }

  // Najdi nejbližší volné číslo
  let counter = 2;
  while (existingSlugs.has(`${base}-${counter}`)) {
    counter++;
  }

  const candidate = `${base}-${counter}`;
  // Zajisti max 100 znaků i s číslem
  if (candidate.length > 100) {
    const suffix = `-${counter}`;
    return base.slice(0, 100 - suffix.length) + suffix;
  }
  return candidate;
}
