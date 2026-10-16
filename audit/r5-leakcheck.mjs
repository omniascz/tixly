// Ověří, že žádná hodnota z nálezů gitleaks není v daných souborech (vypisuje jen počty).
import { execSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
const [jf, ...targets] = process.argv.slice(2);
const r = JSON.parse(readFileSync(jf, 'utf8'));
const secrets = new Set();
for (const x of r) {
  let t; try { t = execSync(`git show "${x.Commit}:${x.File}"`, { encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'] }).split('\n').slice(x.StartLine - 1, x.EndLine).join('\n'); } catch { continue; }
  const [pre, post] = x.Match.split('REDACTED'); const i = t.indexOf(pre); if (i < 0) continue;
  const s = t.slice(i + pre.length, post ? t.indexOf(post, i + pre.length) : undefined);
  if (s.length >= 8) secrets.add(s);
}
const files = targets.flatMap((p) => statSync(p).isDirectory() ? readdirSync(p).map((f) => path.join(p, f)) : [p]);
let hits = 0;
const fix = process.env.MASK === '1';
for (const f of files) {
  let c = readFileSync(f, 'utf8'); let changed = false;
  for (const s of secrets) if (c.includes(s)) { hits++; console.log('NALEZENO v', f, '(délka', s.length + ')'); if (fix) { c = c.split(s).join(`${s.slice(0, 4)}…[${s.length}]`); changed = true; } }
  if (changed) { writeFileSync(f, c); console.log('  zamaskováno:', f); }
}
console.log(`hodnot: ${secrets.size}, souborů: ${files.length}, výskytů: ${hits}`);
