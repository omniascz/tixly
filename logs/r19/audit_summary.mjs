// Kolo 19 — souhrn npm audit --json: počty podle závažnosti a vybrané balíčky. node audit_summary.mjs <audit.json>
import { readFileSync } from 'node:fs';
const a = JSON.parse(readFileSync(process.argv[2], 'utf8'));
console.log('metadata.vulnerabilities:', JSON.stringify(a.metadata.vulnerabilities));
const re = /^(@sentry\/|unplugin$|rollup$|@opentelemetry\/)/;
const rows = Object.values(a.vulnerabilities).sort((x, y) => x.name.localeCompare(y.name));
console.log('\n| balíček | závažnost | přímý | rozsah | fixAvailable |\n|---|---|---|---|---|');
for (const v of rows.filter((v) => re.test(v.name))) {
  const fix = typeof v.fixAvailable === 'object' ? `${v.fixAvailable.name}@${v.fixAvailable.version}${v.fixAvailable.isSemVerMajor ? ' (major)' : ''}` : String(v.fixAvailable);
  console.log(`| ${v.name} | ${v.severity} | ${v.isDirect} | ${v.range} | ${fix} |`);
}
console.log('\nVšechny high/critical:');
for (const v of rows.filter((v) => v.severity === 'high' || v.severity === 'critical')) {
  const adv = v.via.filter((x) => typeof x === 'object').map((x) => x.url).join(' ');
  console.log(`- ${v.name} ${v.severity} via=${v.via.map((x) => (typeof x === 'string' ? x : x.source)).join(',')} ${adv}`);
}
