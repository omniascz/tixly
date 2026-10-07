// Kolo 15 — rozbor hotového .cpuprofile: časová osa po sekundách (idle vs práce) a top vlastní čas podle souboru/funkce.
//   node analyze-cpuprofile.mjs <soubor.cpuprofile> [od-ms] [do-ms]
import { readFileSync } from 'node:fs';

const [file, fromMs = '0', toMs = '1e12'] = process.argv.slice(2);
const p = JSON.parse(readFileSync(file, 'utf8'));
const byId = new Map(p.nodes.map((n) => [n.id, n]));
const t0 = p.startTime;
let t = t0;
const perSec = new Map();
const self = new Map();
const lo = Number(fromMs) * 1000; const hi = Number(toMs) * 1000;
for (let i = 0; i < p.samples.length; i++) {
  t += p.timeDeltas[i] ?? 0;
  const rel = t - t0;
  const n = byId.get(p.samples[i]);
  const fn = n.callFrame.functionName || '(anon)';
  const idle = fn === '(idle)' || fn === '(program)' || fn === '(garbage collector)';
  const sec = Math.floor(rel / 1e6);
  const s = perSec.get(sec) ?? { busy: 0, idle: 0 };
  if (idle && fn === '(idle)') s.idle++; else s.busy++;
  perSec.set(sec, s);
  if (rel < lo || rel > hi) continue;
  const url = n.callFrame.url.replace(/^.*node_modules[\\/]/, 'nm/').replace(/^.*\.next[\\/]/, '.next/').slice(-70);
  const key = `${fn} @ ${url}:${n.callFrame.lineNumber}`;
  self.set(key, (self.get(key) ?? 0) + 1);
}
console.log(`trvání ${((t - t0) / 1e6).toFixed(1)} s, vzorků ${p.samples.length}`);
console.log('sekunda: práce / idle (vzorky)');
console.log([...perSec].sort((a, b) => a[0] - b[0]).map(([s, v]) => `${s}:${v.busy}/${v.idle}`).join('  '));
const total = [...self.values()].reduce((a, b) => a + b, 0);
console.log(`\ntop vlastní čas v okně ${fromMs}–${toMs} ms:`);
for (const [k, v] of [...self].sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(`${(100 * v / total).toFixed(1).padStart(5)} %  ${k}`);
