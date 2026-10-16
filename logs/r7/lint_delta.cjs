// Porovná ESLint JSON (soubor × pravidlo) s nextjs-boilerplate/eslint-baseline.json. Exit 1 při nárůstu.
// node lint_delta.cjs <eslint.json> <nextjs-boilerplate dir>
const path = require('path');
const [jsonF, root] = process.argv.slice(2);
const r = require(path.resolve(jsonF));
const base = require(path.join(path.resolve(root), 'eslint-baseline.json')).files;
let grow = 0;
for (const f of r) {
  const rel = path.relative(path.resolve(root), f.filePath).split(path.sep).join('/');
  const cnt = {};
  for (const m of f.messages) if (m.severity === 2) cnt[m.ruleId] = (cnt[m.ruleId] || 0) + 1;
  for (const [k, v] of Object.entries(cnt)) {
    const b = (base[rel] || {})[k] || 0;
    if (v > b) grow++;
    console.log(`${rel}  ${k}  ${v} (baseline ${b})${v > b ? '  NÁRŮST' : ''}`);
  }
}
console.log(grow ? `nárůst: ${grow}` : 'bez nárůstu');
process.exit(grow ? 1 : 0);
