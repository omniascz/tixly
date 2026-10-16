// Pro každý nález: je stejná hodnota stále v souboru na refu? (vypisuje jen ano/ne)
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
const [jf, ...refs] = process.argv.slice(2);
const r = JSON.parse(readFileSync(jf, 'utf8'));
const get = (ref, f) => { try { return execSync(`git show "${ref}:${f}"`, { encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'] }); } catch { return null; } };
const rows = []; const seen = new Map();
for (const x of r) {
  const text = get(x.Commit, x.File)?.split('\n').slice(x.StartLine - 1, x.EndLine).join('\n') ?? '';
  const [pre, post] = x.Match.split('REDACTED'); const i = text.indexOf(pre);
  const s = i >= 0 ? text.slice(i + pre.length, post ? text.indexOf(post, i + pre.length) : undefined) : null;
  const inRef = Object.fromEntries(refs.map((ref) => { const t = get(ref, x.File); return [ref, t == null ? 'soubor ne' : (s && t.includes(s) ? 'ANO' : 'ne')]; }));
  rows.push({ fp: x.Fingerprint, rule: x.RuleID, file: x.File, line: x.StartLine, commit: x.Commit.slice(0, 8), ...inRef });
}
writeFileSync(jf.replace('.json', '_inhead.json'), JSON.stringify(rows, null, 1));
const g = {}; for (const x of rows) { const k = `${x.rule} | ${x.file} | ` + refs.map((ref) => `${ref}=${x[ref]}`).join(' '); g[k] = (g[k] ?? 0) + 1; }
for (const [k, n] of Object.entries(g)) console.log(`${n}x ${k}`);
