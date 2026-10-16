// Kolo 5 / krok 1 — maskovaný kontext nálezů gitleaks (hodnota se NIKDY nevypisuje: max 4 znaky + délka).
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const [file] = process.argv.slice(2);
const r = JSON.parse(readFileSync(file, 'utf8'));
const cache = new Map();
const blob = (c, f) => { const k = c + ':' + f; if (!cache.has(k)) { try { cache.set(k, execSync(`git show "${c}:${f}"`, { encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'] }).split('\n')); } catch { cache.set(k, null); } } return cache.get(k); };
const inHead = (f, secretFp) => { try { execSync(`git cat-file -e master:"${f}"`, { stdio: 'ignore' }); return 'soubor v master'; } catch { return 'soubor NENÍ v master'; } };
const out = [];
for (const x of r) {
  const lines = blob(x.Commit, x.File);
  let masked = '(řádek nenalezen)', len = null, prefix4 = '';
  if (lines) {
    const line = lines[x.StartLine - 1] ?? '';
    const [pre, post] = x.Match.split('REDACTED');
    let i = line.indexOf(pre); let s = null;
    if (i >= 0) { const st = i + pre.length; const en = post ? line.indexOf(post, st) : line.length; if (en > st) s = line.slice(st, en); }
    if (s) { len = s.length; prefix4 = s.slice(0, 4); masked = line.replace(s, `${prefix4}…[${len} zn.]`).trim().slice(0, 200); }
    else masked = '(nelze zarovnat) ' + x.Match.slice(0, 120);
  }
  out.push({ rule: x.RuleID, file: x.File, line: x.StartLine, commit: x.Commit.slice(0, 8), date: x.Date.slice(0, 10), fp: x.Fingerprint, masked, len });
}
console.log(JSON.stringify(out, null, 1));
