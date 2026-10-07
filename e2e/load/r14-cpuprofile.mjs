/**
 * Kolo 14 / krok 2 — CPU profil běžícího Node serveru přes Inspector protokol (server spuštěný s --inspect).
 *   node load/r14-cpuprofile.mjs <ws-url> <sekund> <výstup.cpuprofile>
 * Pak vypíše funkce s největším vlastním časem (self time) seskupené podle souboru / balíčku.
 */
import { writeFileSync } from 'node:fs';

const [wsUrl, secs = '60', out = 'server.cpuprofile'] = process.argv.slice(2);
const ws = new WebSocket(wsUrl);
let id = 0; const pending = new Map();
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d.result); pending.delete(d.id); } };
await new Promise((r) => { ws.onopen = r; });
await send('Profiler.enable');
await send('Profiler.setSamplingInterval', { interval: 1000 });
await send('Profiler.start');
await new Promise((r) => setTimeout(r, Number(secs) * 1000));
const { profile } = await send('Profiler.stop');
writeFileSync(out, JSON.stringify(profile));
ws.close();

// self time podle balíčku / souboru
const dt = new Map();
const byId = new Map(profile.nodes.map((n) => [n.id, n]));
for (let i = 0; i < profile.samples.length; i++) {
  const n = byId.get(profile.samples[i]); const d = profile.timeDeltas[i] ?? 0;
  const url = n.callFrame.url || `(${n.callFrame.functionName || 'native'})`;
  const pkg = /node_modules[\\/](@[^\\/]+[\\/][^\\/]+|[^\\/]+)/.exec(url)?.[1] ?? url.replace(/^.*[\\/]\.next[\\/]/, '.next/').slice(-70);
  const key = `${pkg} :: ${n.callFrame.functionName || '(anon)'}`;
  dt.set(key, (dt.get(key) ?? 0) + d);
}
const total = [...dt.values()].reduce((a, b) => a + b, 0);
const pkgs = new Map();
for (const [k, v] of dt) { const p = k.split(' :: ')[0]; pkgs.set(p, (pkgs.get(p) ?? 0) + v); }
const top = (m, n) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${(v / 1000).toFixed(0).padStart(7)} ms  ${(100 * v / total).toFixed(1).padStart(5)} %  ${k}`);
console.log(`celkem vzorkováno ${(total / 1000).toFixed(0)} ms\n— podle balíčku/souboru —\n${top(pkgs, 25).join('\n')}\n— funkce —\n${top(dt, 30).join('\n')}`);
