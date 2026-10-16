// Vyrobi audit/tools/schema-drift-guard.local.mjs z ORIGINALNIHO nextjs-boilerplate/scripts/schema-drift-guard.mjs.
// Meni JEN zdroj pripojeni (Neon API -> env AUDIT_DB_URL) a importy (absolutni cesty do node_modules).
// Extrakce SQL, PREPARE kontrola, baseline logika a exit kody zustavaji 1:1.
// Pouziti: node audit/tools/make-local-guard.mjs [cesta_k_guardu]
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const nm = path.join(root, 'nextjs-boilerplate/node_modules');
const src = process.argv[2] || path.join(root, 'nextjs-boilerplate/scripts/schema-drift-guard.mjs');
let s = readFileSync(src, 'utf8').replace(/\r\n/g, '\n');

function rep(a, b) {
  if (!s.includes(a)) throw new Error('patch anchor missing: ' + a);
  s = s.replace(a, b);
}
rep("import ts from 'typescript';", `import ts from '${pathToFileURL(path.join(nm, 'typescript/lib/typescript.js'))}';`);
rep("import pg from 'pg';", `import pg from '${pathToFileURL(path.join(nm, 'pg/lib/index.js'))}';`);
rep("if (!KEY) { console.error('need NEON_API_KEY'); process.exit(2); }",
  "if (!process.env.AUDIT_DB_URL) { console.error('need AUDIT_DB_URL'); process.exit(2); }");

const start = s.indexOf('async function connUri(branchId) {');
const end = s.indexOf('\n}', start);
if (start < 0 || end < 0) throw new Error('connUri not found');
s = s.slice(0, start) +
  'async function connUri(branchId) { return process.env.AUDIT_DB_URL; /* AUDIT: lokalni izolovana DB, zadny Neon */ }' +
  s.slice(end + 2);

writeFileSync(path.join(root, 'audit/tools/schema-drift-guard.local.mjs'),
  '// GENEROVANO audit/tools/make-local-guard.mjs — NEEDITOVAT\n' + s);
console.log('ok');
