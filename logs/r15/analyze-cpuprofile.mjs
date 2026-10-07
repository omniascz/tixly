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

// ---- seskupení vlastního času podle souboru/balíčku + inkluzivní čas podle funkcí (volitelně GROUP=1)
if (process.env.GROUP) {
  const parent = new Map();
  for (const n of p.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
  const byFile = new Map(); const incl = new Map();
  let tt = t0;
  for (let i = 0; i < p.samples.length; i++) {
    tt += p.timeDeltas[i] ?? 0; const rel = tt - t0; if (rel < lo || rel > hi) continue;
    let id = p.samples[i]; const n = byId.get(id);
    const u = n.callFrame.url.replace(/^.*node_modules[\/]((@[^\/]+[\/])?[^\/]+).*$/, 'nm:$1').replace(/^.*\.next[\/]server[\/]/, '.next:').replace(/^node:.*/, 'node-core');
    byFile.set(u || '(native)', (byFile.get(u || '(native)') ?? 0) + 1);
    const seen = new Set();
    while (id !== undefined) { const m = byId.get(id); const k = `${m.callFrame.functionName || '(anon)'} @ ${m.callFrame.url.replace(/^.*node_modules[\/]/, 'nm/').replace(/^.*\.next[\/]/, '.next/').slice(-60)}:${m.callFrame.lineNumber}`; if (!seen.has(k)) { incl.set(k, (incl.get(k) ?? 0) + 1); seen.add(k); } id = parent.get(id); }
  }
  const tot = [...byFile.values()].reduce((a, b) => a + b, 0);
  console.log('\nvlastní čas podle souboru/balíčku:');
  for (const [k, v] of [...byFile].sort((a, b) => b[1] - a[1]).slice(0, 18)) console.log(`${(100 * v / tot).toFixed(1).padStart(5)} %  ${k}`);
  console.log('\ninkluzivní čas (top 40):');
  for (const [k, v] of [...incl].sort((a, b) => b[1] - a[1]).slice(0, 40)) console.log(`${(100 * v / tot).toFixed(1).padStart(5)} %  ${k}`);
}
