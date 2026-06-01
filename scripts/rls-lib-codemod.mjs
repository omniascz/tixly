#!/usr/bin/env node
/**
 * RLS lib-pool codemod — přepne lib soubory s vlastním `new Pool` na sdílené
 * context-aware `db()` z rls-pool. Lib pak DĚDÍ kontext volajícího (route).
 *
 * Pokrývá JEN kanonický vzor:
 *   let pool: Pool | null = null;
 *   function db(): Pool { if (!pool) pool = new Pool({ connectionString: ... }); return pool; }
 *   ... db().query / db().connect ...
 *
 * Swap je bezpečný: db() bez kontextu = stejné chování jako vlastní pool bez
 * kontextu (jen public řádky). Přidává schopnost zdědit kontext, nic nezhoršuje.
 * Bootstrap liby (běžící PŘED kontextem) NEpřepínat tímto — potřebují service obal.
 *
 * Použití: node scripts/rls-lib-codemod.mjs a/b,c/d [--apply]   (cesty rel. k src/lib, bez .ts)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2).filter((a) => a !== '--apply');
const APPLY = process.argv.includes('--apply');
if (args.length === 0) { console.error('Usage: rls-lib-codemod.mjs <file,file,...> [--apply]'); process.exit(1); }

const LIB_ROOT = join(process.cwd(), 'nextjs-boilerplate', 'src', 'lib');
const files = args[0].split(',').map((f) => join(LIB_ROOT, ...f.split('/')) + '.ts');

const POOL_BLOCK = /let pool: Pool \| null = null;\r?\nfunction db\(\): Pool \{[\s\S]*?return pool;\r?\n\}\r?\n/;
const PG_IMPORT = /import \{ ([^}]*) \} from 'pg';\r?\n/;

let ok = 0, skip = 0;
for (const file of files) {
  let src;
  try { src = readFileSync(file, 'utf8'); } catch { console.log(`SKIP (nenalezen): ${file}`); skip++; continue; }
  const orig = src;
  if (!POOL_BLOCK.test(src)) { console.log(`SKIP (nezná pool block): ${file}`); skip++; continue; }

  src = src.replace(POOL_BLOCK, '');

  // pg import: po odstranění bloku zjisti, zda zbyly použité pg typy
  const m = src.match(PG_IMPORT);
  if (m) {
    const names = m[1].split(',').map((n) => n.trim().replace(/^type /, ''));
    const stillUsed = names.filter((n) => n !== 'Pool' && new RegExp(`\\b${n}\\b`).test(src.replace(PG_IMPORT, '')));
    const nl = src.includes('\r\n') ? '\r\n' : '\n';
    if (stillUsed.length > 0) {
      src = src.replace(PG_IMPORT, `import type { ${stillUsed.join(', ')} } from 'pg';${nl}`);
    } else {
      src = src.replace(PG_IMPORT, '');
    }
  }

  // přidej db import za první import; pokud žádný není (pg byl jediný), za úvodní
  // blokový komentář /** */, jinak na začátek souboru
  const nl = src.includes('\r\n') ? '\r\n' : '\n';
  const DB_IMP = `import { db } from '@/lib/db/rls-pool';`;
  if (/^import /m.test(src)) {
    src = src.replace(/^(import [^\n]*\n)/m, `$1${DB_IMP}${nl}`);
  } else {
    const c = src.match(/^\s*\/\*\*[\s\S]*?\*\/\r?\n/);
    src = c ? src.slice(0, c[0].length) + DB_IMP + nl + src.slice(c[0].length) : DB_IMP + nl + src;
  }

  if (src !== orig) {
    ok++;
    if (APPLY) writeFileSync(file, src);
    else console.log(`WOULD SWAP: ${file.split('lib' + (process.platform === 'win32' ? '\\' : '/'))[1]}`);
  }
}
console.log(`\n=== ${APPLY ? 'APLIKOVÁNO' : 'DRY-RUN'}: swap=${ok}, skip=${skip} ===`);
