// Tabulka zbývajících high/critical: balíček | závažnost | přímá/tranzitivní | potřebná verze | prod/dev
// argv: <audit.json> <package.json> <prod-tree.json (npm ls --omit=dev --all --json)> <modul>
const fs = require('fs');
const [auditF, pkgF, prodF, mod] = process.argv.slice(2);
const audit = JSON.parse(fs.readFileSync(auditF, 'utf8'));
const pkg = JSON.parse(fs.readFileSync(pkgF, 'utf8'));
const direct = new Set([...Object.keys(pkg.dependencies || {}), ...Object.keys(pkg.devDependencies || {})]);
const prodNames = new Set();
const walk = (n) => { for (const [k, v] of Object.entries(n.dependencies || {})) { if (!prodNames.has(k)) { prodNames.add(k); walk(v); } } };
walk(JSON.parse(fs.readFileSync(prodF, 'utf8')));
const rows = [];
for (const [n, v] of Object.entries(audit.vulnerabilities)) {
  if (!['high', 'critical'].includes(v.severity)) continue;
  const fa = v.fixAvailable;
  const needs = fa === false ? 'bez opravy' : fa === true ? 'v rozsahu, blokuje rodič' : `${fa.name}@${fa.version}${fa.isSemVerMajor ? ' (major)' : ''}`;
  const titles = [...new Set(v.via.filter((x) => typeof x === 'object').map((x) => x.title))];
  const viaPk = v.via.filter((x) => typeof x === 'string');
  rows.push({ mod, n, sev: v.severity, dt: direct.has(n) ? 'přímá' : 'tranzitivní', needs, scope: prodNames.has(n) ? 'runtime' : 'dev/build', what: titles[0] ?? `přes ${viaPk.join(', ')}` });
}
rows.sort((a, b) => (a.sev === b.sev ? a.n.localeCompare(b.n) : a.sev === 'critical' ? -1 : 1));
for (const r of rows) console.log([r.mod, r.n, r.sev, r.dt, r.needs, r.scope, r.what.slice(0, 110)].join('\t'));
