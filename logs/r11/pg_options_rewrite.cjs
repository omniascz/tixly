// Kolo 11: `new Pool({ connectionString: process.env.DATABASE_URL })` → `new Pool(pgPoolOptions(process.env.DATABASE_URL))`
// + import pgPoolOptions. Jen přesný tvar; cokoli jiného se vypíše a nechá na ruční úpravu.
const fs = require('fs');
const path = require('path');
const EXACT = 'new Pool({ connectionString: process.env.DATABASE_URL })';
const NEW = 'new Pool(pgPoolOptions(process.env.DATABASE_URL))';
const IMPORT = "import { pgPoolOptions } from '@/lib/db/pg-options';";
let changed = 0;
for (const f of process.argv.slice(2)) {
  let s = fs.readFileSync(f, 'utf8');
  const eol = s.includes('\r\n') ? '\r\n' : '\n';
  const n = s.split(EXACT).length - 1;
  if (n === 0) { console.log('BEZ PŘESNÉHO TVARU:', f); continue; }
  s = s.split(EXACT).join(NEW);
  if (!s.includes(IMPORT)) {
    const lines = s.split(eol);
    const i = lines.findIndex((l) => /^import .*from 'pg';/.test(l));
    if (i < 0) { console.log('BEZ importu pg:', f); continue; }
    lines.splice(i + 1, 0, IMPORT);
    s = lines.join(eol);
  }
  fs.writeFileSync(f, s);
  changed += n;
  console.log('OK', n, f);
}
console.log('nahrazeno', changed);
