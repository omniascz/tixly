// @vitest-environment node
/**
 * Kolo 2 / krok 5 — P1: `/api/cart/validate` nemá volajícího a padá (audit e2e_02:P1 → 500,
 * dotaz na neexistující `price_halire`). Rozhodnutí: routu odstranit.
 * Test: routa neexistuje (modul nejde načíst) a nic v src/ ani v mobilní aplikaci ji nevolá.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import path from 'path';
import { hasLocalDb } from './helpers/local-fixture';

const run = describe.skipIf(!hasLocalDb);
const ROOT = path.resolve(__dirname, '..');

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir)) {
    if (f === 'node_modules' || f.startsWith('.')) continue;
    const p = path.join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|js|mjs)$/.test(f)) out.push(p);
  }
  return out;
}

run('Krok 5 — P1: /api/cart/validate odstraněna', () => {
  it('routa neexistuje', async () => {
    expect(existsSync(path.join(ROOT, 'src/app/api/cart/validate/route.ts'))).toBe(false);
    await expect(import(/* @vite-ignore */ path.join(ROOT, 'src/app/api/cart/validate/route.ts'))).rejects.toThrow();
  });

  it('nikdo ji nevolá (src/, mobile/)', () => {
    const refs = [...walk(path.join(ROOT, 'src')), ...walk(path.join(ROOT, '../mobile/app')), ...walk(path.join(ROOT, '../mobile/lib'))]
      .filter((f) => readFileSync(f, 'utf8').includes('/api/cart/validate'));
    expect(refs).toEqual([]);
  });
});
