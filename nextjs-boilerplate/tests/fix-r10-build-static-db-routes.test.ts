/**
 * Kolo 10 / krok 1 — build nesmí sahat na databázi.
 *
 * Route handler `GET()` bez parametru request a bez dynamických API Next 14 při `next build`
 * PRERENDERUJE (spustí ho a výsledek zapeče staticky). Když handler čte DB:
 *   - spojení selže → „Error occurred prerendering page" → celý build skončí chybou
 *     (`/api/postal-fees`: `db().connect()` mimo try, reprodukováno čistým buildem bez DB);
 *   - nebo chybu chytí a zapeče se odpověď z doby buildu (`/api/health/db` by navždy hlásil 503,
 *     `/api/public/incidents` prázdný seznam).
 * Každý takový handler musí mít `export const dynamic = 'force-dynamic'` (nebo `revalidate`).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const APP = join(__dirname, '..', 'src', 'app');

function routeFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...routeFiles(p));
    else if (name === 'route.ts' || name === 'route.tsx') out.push(p);
  }
  return out;
}

describe('build bez DB — statické GET handlery nečtou databázi', () => {
  it('každý GET() bez request, který čte DB, je force-dynamic nebo má revalidate', () => {
    const offenders = routeFiles(APP)
      .filter((f) => {
        const src = readFileSync(f, 'utf8');
        const staticGet = /export\s+(async\s+)?function\s+GET\s*\(\s*\)/.test(src);
        const readsDb = /@\/lib\/db|from\s+'pg'/.test(src);
        // Jen skutečný export na začátku řádku — ne text v komentáři.
        const optedOut = /^export\s+const\s+(dynamic|revalidate)\s*=/m.test(src);
        return staticGet && readsDb && !optedOut;
      })
      .map((f) => relative(APP, f).replace(/\\/g, '/'));
    expect(offenders).toEqual([]);
  });
});
