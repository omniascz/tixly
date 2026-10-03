// Porovná chyby ESLint (soubor × pravidlo) ve změněných souborech: e5789d7 vs pracovní strom.
// Jeden proces (ESLint API) — TS program se staví jednou, ne 2× na soubor.
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { ESLint } from 'eslint';
const eslint = new ESLint();
const files = readFileSync('../logs/r4/4_r4_changed_src.txt', 'utf8').trim().split('\n').map((f) => f.trim()).filter((f) => /\.(ts|tsx)$/.test(f));
const count = (msgs) => { const c = {}; for (const m of msgs) if (m.severity === 2) c[m.ruleId] = (c[m.ruleId] ?? 0) + 1; return c; };
const lint = async (src, f) => (await eslint.lintText(src, { filePath: f }))[0]?.messages ?? [];
let added = 0;
for (const f of files) {
  let old;
  try { old = execSync(`git show e5789d7:nextjs-boilerplate/${f}`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }); } catch { old = null; }
  const nowMsgs = await lint(readFileSync(f, 'utf8'), f);
  const now = count(nowMsgs);
  const before = old === null ? {} : count(await lint(old, f));
  for (const [rule, n] of Object.entries(now)) {
    const d = n - (before[rule] ?? 0);
    if (d > 0) {
      added += d;
      const lines = nowMsgs.filter((m) => m.severity === 2 && m.ruleId === rule).map((m) => m.line).join(',');
      console.log(`${f} ${rule} +${d} (${before[rule] ?? 0} -> ${n})${old === null ? ' [nový soubor]' : ''} ř.${lines}`);
    }
  }
}
console.log(`SOUBORU: ${files.length}`);
console.log(`PRIDANO kolem 4: ${added}`);
