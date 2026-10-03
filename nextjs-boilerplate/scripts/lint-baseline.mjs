/**
 * ESLint s baseline — CI blokuje NOVÉ chyby, existující dluh (stav k 2026-10-03, kolo 4)
 * neshazuje a hromadně se neopravuje.
 *
 * Baseline = počet chyb (severity 2) pro každou dvojici soubor × pravidlo.
 * CI selže, když u některé dvojice počet VZROSTE nebo se objeví nová (nový soubor / nové
 * pravidlo). Když počet klesne, vypíše se, že baseline lze utáhnout (`--update`).
 *
 * Použití (z nextjs-boilerplate/):
 *   node scripts/lint-baseline.mjs            # kontrola (CI)
 *   node scripts/lint-baseline.mjs --update   # přegeneruje eslint-baseline.json
 *   node scripts/lint-baseline.mjs --from <eslint.json>  # místo spuštění eslintu čte hotový výstup
 *
 * Exit: 0 = žádná nová chyba; 1 = nové chyby; 2 = chyba nástroje.
 */
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const BASELINE = path.resolve('eslint-baseline.json');
const argv = process.argv.slice(2);
const update = argv.includes('--update');
const fromIdx = argv.indexOf('--from');

function runEslint() {
  if (fromIdx >= 0) return JSON.parse(readFileSync(argv[fromIdx + 1], 'utf8'));
  try {
    return JSON.parse(execSync('npx eslint src -f json', { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, stdio: ['ignore', 'pipe', 'inherit'] }));
  } catch (e) {
    // eslint vrací exit 1, když najde chyby — JSON je ve stdout
    if (e.stdout) return JSON.parse(e.stdout);
    console.error('eslint selhal:', e.message);
    process.exit(2);
  }
}

function tally(results) {
  const out = {};
  for (const r of results) {
    const file = path.relative(process.cwd(), r.filePath).split(path.sep).join('/');
    for (const m of r.messages) {
      if (m.severity !== 2) continue;
      const rule = m.ruleId ?? '(parse)';
      out[file] ??= {};
      out[file][rule] = (out[file][rule] ?? 0) + 1;
    }
  }
  return out;
}

const current = tally(runEslint());
const total = Object.values(current).reduce((s, r) => s + Object.values(r).reduce((a, b) => a + b, 0), 0);

if (update) {
  const sorted = Object.fromEntries(Object.keys(current).sort().map((f) => [f, current[f]]));
  writeFileSync(BASELINE, JSON.stringify({ note: 'Existující chyby ESLint (soubor × pravidlo). CI blokuje jen nárůst. Snižovat průběžně, neopravovat hromadně.', total, files: sorted }, null, 1) + '\n');
  console.log(`baseline zapsán: ${BASELINE} (${total} chyb)`);
  process.exit(0);
}

if (!existsSync(BASELINE)) { console.error(`chybí ${BASELINE} — vygeneruj: node scripts/lint-baseline.mjs --update`); process.exit(2); }
const base = JSON.parse(readFileSync(BASELINE, 'utf8')).files;

const increases = [];
let decreased = 0;
for (const [file, rules] of Object.entries(current)) {
  for (const [rule, n] of Object.entries(rules)) {
    const b = base[file]?.[rule] ?? 0;
    if (n > b) increases.push(`${file}  ${rule}  ${b} -> ${n}`);
  }
}
for (const [file, rules] of Object.entries(base)) {
  for (const [rule, b] of Object.entries(rules)) if ((current[file]?.[rule] ?? 0) < b) decreased += b - (current[file]?.[rule] ?? 0);
}

console.log(`ESLint: ${total} chyb celkem (baseline ${JSON.parse(readFileSync(BASELINE, 'utf8')).total})`);
if (decreased > 0) console.log(`o ${decreased} méně než baseline — lze utáhnout: node scripts/lint-baseline.mjs --update`);
if (increases.length) {
  console.error(`\nNOVÉ chyby ESLint nad baseline (${increases.length}):`);
  for (const l of increases) console.error('  x ' + l);
  process.exit(1);
}
console.log('žádná nová chyba nad baseline');
