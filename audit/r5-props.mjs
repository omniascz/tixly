// Vlastnosti tajemství bez výpisu hodnoty: identifikátor? placeholder? UUID? hex? délka.
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const r = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const seen = new Set();
for (const x of r) {
  const k = x.File + '|' + x.Match; if (seen.has(k)) continue; seen.add(k);
  let line; try { line = execSync(`git show "${x.Commit}:${x.File}"`, { encoding: 'utf8', maxBuffer: 1 << 28 }).split('\n'); } catch { continue; }
  const text = line.slice(x.StartLine - 1, x.EndLine).join('\n');
  const [pre, post] = x.Match.split('REDACTED');
  const i = text.indexOf(pre); if (i < 0) { console.log(x.File, 'nezarovnano'); continue; }
  const st = i + pre.length; const en = post ? text.indexOf(post, st) : text.length; const s = text.slice(st, en);
  console.log([x.File + ':' + x.StartLine, 'len=' + s.length, 'identifikator=' + /^[A-Za-z_][A-Za-z0-9_.]*$/.test(s) && /[a-z]_/.test(s) || /^[A-Z_]+=/.test(s),
    'uuid=' + /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s), 'hex=' + /^[0-9a-f]+$/i.test(s),
    'placeholder=' + /(x{3,}|\.\.\.|test|fake|example|dummy|abc123|changeme|your_)/i.test(s), 'zacina=' + s.slice(0, 4).replace(/[A-Za-z0-9]/g, (c, j) => c)].join(' '));
}
