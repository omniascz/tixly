// Kolo 15 — průměr p95 po krocích: Next 14 dnes vs Next 15 dnes (stejný stroj, střídavě) + kolo 14 (jiný den).
import { readFileSync } from 'node:fs';
const D = new URL('./', import.meta.url); const R14 = new URL('../../r14/load/', import.meta.url);
const steps = ['page', 'plan', 'hold', 'checkout', 'pay', 'webhook'];
const p95 = (dir, l, s) => JSON.parse(readFileSync(new URL(`summary_${l}.json`, dir), 'utf8')).metrics[`t_${s}`]['p(95)'];
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const median = (a) => { const b = [...a].sort((x, y) => x - y); const m = b.length >> 1; return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2; };
const g = { n14: ['n14_today_1', 'n14_ab_2', 'n14_ab_3', 'n14_ab_4'], n15: ['r15_pool10_1', 'r15_pool10_2', 'n15_ab_1', 'n15_ab_3', 'n15_ab_5'], r14: ['native_after_1', 'native_after_2'] };
const f = (ms) => (ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${Math.round(ms)} ms`);
console.log('| krok | kolo 14 p95 (2 běhy, 2026-10-07) | Next 14 dnes p95 průměr / medián (4 běhy) | Next 15 dnes p95 průměr / medián (5 běhů) | Next 15 vs 14: průměr / medián | jednotlivé běhy N14 ; N15 |');
console.log('|---|---|---|---|---|---|');
for (const s of steps) {
  const r14 = mean(g.r14.map((l) => p95(R14, l, s))); const a = mean(g.n14.map((l) => p95(D, l, s))); const b = mean(g.n15.map((l) => p95(D, l, s)));
  const A = g.n14.map((l) => p95(D, l, s)); const B = g.n15.map((l) => p95(D, l, s));
  console.log(`| ${s} | ${f(r14)} | ${f(a)} / ${f(median(A))} | ${f(b)} / ${f(median(B))} | ${((b / a - 1) * 100).toFixed(1)} % / ${((median(B) / median(A) - 1) * 100).toFixed(1)} % | ${A.map(f).join(', ')} ; ${B.map(f).join(', ')} |`);
}
