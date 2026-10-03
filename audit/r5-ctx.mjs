// Maskovaný kontext ±N řádků: každý token >=12 znaků [A-Za-z0-9+/=_.-] → první 4 znaky + délka.
import { execSync } from 'node:child_process';
const [commit, file, line, n = '2'] = process.argv.slice(2);
const L = execSync(`git show "${commit}:${file}"`, { encoding: 'utf8', maxBuffer: 1 << 28 }).split('\n');
const m = (s) => s.replace(/[A-Za-z0-9+/=_.\-]{12,}/g, (t) => (/^[a-z_.]+$/.test(t) || /^[A-Z_]+$/.test(t) ? t : `${t.slice(0, 4)}…[${t.length}]`));
for (let i = Math.max(1, +line - +n); i <= Math.min(L.length, +line + +n); i++) console.log(`${i === +line ? '>' : ' '}${i}: ${m(L[i - 1]).slice(0, 220)}`);
