// Kolo 19 (převzato v kole 20) — z výstupu `next build`: normalizovaná tabulka rout (cesta + typ) a souhrn First Load JS.
//   node routes.mjs <build.txt> <routes.norm.txt> > souhrn.md
import { readFileSync, writeFileSync } from 'node:fs';
const [src, dst] = process.argv.slice(2);
const kb = (s) => { const [n, u] = s.split(' '); return Number(n) * (u === 'MB' ? 1024 : u === 'B' ? 1 / 1024 : 1); };
const rows = [];
let shared = null; let middleware = null; const chunks = [];
for (const line of readFileSync(src, 'utf8').split(/\r?\n/)) {
  let m = line.match(/^[┌├└│ ]*([○ƒ●λ◐])\s+(\/\S*)\s+([\d.]+ (?:B|kB|MB))\s+([\d.]+ (?:B|kB|MB))/);
  if (m) { rows.push({ type: m[1], route: m[2], size: m[3], first: m[4] }); continue; }
  m = line.match(/^[┌├└│ ]*([○ƒ●λ◐])\s+(\/\S*)\s*$/);
  if (m) { rows.push({ type: m[1], route: m[2], size: '', first: '' }); continue; }
  m = line.match(/First Load JS shared by all\s+([\d.]+ (?:B|kB|MB))/); if (m) { shared = m[1]; continue; }
  m = line.match(/^\s+[├└] (chunks\/\S+|other shared chunks \(total\))\s+([\d.]+ (?:B|kB|MB))/); if (m) { chunks.push(`${m[1]} ${m[2]}`); continue; }
  m = line.match(/ƒ Middleware\s+([\d.]+ (?:B|kB|MB))/); if (m) middleware = m[1];
}
const norm = rows.map((r) => `${r.type} ${r.route}`).sort();
writeFileSync(dst, `${norm.join('\n')}\n`);
const count = {}; for (const r of rows) count[r.type] = (count[r.type] ?? 0) + 1;
console.log(`rout: ${rows.length} ${JSON.stringify(count)}`);
console.log(`First Load JS shared by all: ${shared}; Middleware: ${middleware}`);
for (const c of chunks) console.log(`  - ${c}`);
console.log('\n5 největších stránek podle First Load JS:\n\n| routa | typ | velikost | First Load JS |\n|---|---|---|---|');
for (const r of rows.filter((r) => r.first).sort((a, b) => kb(b.first) - kb(a.first) || a.route.localeCompare(b.route)).slice(0, 5)) {
  console.log(`| ${r.route} | ${r.type} | ${r.size} | ${r.first} |`);
}
