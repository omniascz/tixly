// Kolo 17 / krok 2 — srovnání Next 14 (f2af248a) × Next 15 (e14cbad2) z artefaktů workflow loadtest.yml.
//   node logs/r17/compare.mjs > logs/r17/2_compare.md
import { readFileSync } from 'node:fs';

const STEPS = ['page', 'plan', 'hold', 'checkout', 'pay', 'webhook'];
const TARGET = { hold: 1500, checkout: 1500 };
const SEPARATE = ['37767338789', '37767386803', '37767375587', '37767402384']; // krok 2: každá verze 2×, samostatné běhy
const PAIRED = ['37767610402', '37770078757', '37770629805'];                 // obě verze v jednom běhu (baseline_ref)
const TRIAL = ['37766203272'];                                                 // zkušební běh e14cbad2
const med = (a) => { const s = a.filter((x) => x != null).sort((x, y) => x - y); const h = s.length >> 1; return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2; };
const ms = (v) => (v >= 1000 ? `${(v / 1000).toFixed(2)} s` : `${Math.round(v)} ms`);
const pct = (a, b) => `${b >= a ? '+' : ''}${((100 * (b - a)) / a).toFixed(1)} %`;
const load = (id) => JSON.parse(readFileSync(new URL(`runs/${id}/loadtest-${id}/results.json`, import.meta.url), 'utf8'));
const v = (n) => (n.startsWith('14') ? 'n14' : 'n15');

const all = [];
for (const [kind, ids] of [['samostatný', SEPARATE], ['párový', PAIRED], ['zkušební', TRIAL]]) {
  for (const id of ids) {
    const r = load(id);
    const order = r.versions.length > 1 ? Object.fromEntries(r.versions.map((x) => [x.label, x.next])) : null;
    for (const run of r.runs) all.push({ id, kind, cpu: r.runner.cpuModel.replace(/\s+Processor|\(R\)|-Core/g, '').trim(), ver: v(run.next), order, ...run });
  }
}
const L = [];
const table = (title, rows) => {
  L.push(`### ${title}`, '', '| krok | p95 Next 14 (medián) | p95 Next 15 (medián) | rozdíl | cíl (< 1,5 s) splněn |', '|---|---|---|---|---|');
  for (const s of STEPS) {
    const a = med(rows.filter((x) => x.ver === 'n14').map((x) => x.steps[s].p95));
    const b = med(rows.filter((x) => x.ver === 'n15').map((x) => x.steps[s].p95));
    const t = TARGET[s] ? `Next 14 ${a < TARGET[s] ? 'ano' : 'ne'} / Next 15 ${b < TARGET[s] ? 'ano' : 'ne'}` : '—';
    L.push(`| ${s} | ${ms(a)} | ${ms(b)} | ${pct(a, b)} | ${t} |`);
  }
  L.push('', `běhů: Next 14 ${rows.filter((x) => x.ver === 'n14').length}, Next 15 ${rows.filter((x) => x.ver === 'n15').length}`, '');
};

L.push('# Kolo 17 / krok 2 — srovnání p95 po krocích', '');
table('A) Zadání kroku 2: 4 samostatné workflow běhy (každá verze 2× po 3 bězích)', all.filter((x) => x.kind === 'samostatný'));
table('B) Párové běhy: obě verze za sebou na tomtéž stroji (3 workflow běhy × 3+3 běhy, 1× obrácené pořadí)', all.filter((x) => x.kind === 'párový'));

L.push('### C) Párové běhy po strojích (medián p95 hold / checkout / webhook; rozdíl Next 15 proti Next 14)', '',
  '| workflow běh | CPU | pořadí | Next 14 | Next 15 | hold | checkout | webhook | page | plan |', '|---|---|---|---|---|---|---|---|---|---|');
for (const id of PAIRED) {
  const rs = all.filter((x) => x.id === id);
  const m = (ver, s) => med(rs.filter((x) => x.ver === ver).map((x) => x.steps[s].p95));
  const order = rs[0].order.base.startsWith('14') ? 'Next 14 → 15' : 'Next 15 → 14';
  L.push(`| ${id} | ${rs[0].cpu} | ${order} | ${['hold', 'checkout', 'webhook'].map((s) => ms(m('n14', s))).join(' / ')} | ${['hold', 'checkout', 'webhook'].map((s) => ms(m('n15', s))).join(' / ')} | ${['hold', 'checkout', 'webhook', 'page', 'plan'].map((s) => pct(m('n14', s), m('n15', s))).join(' | ')} |`);
}
L.push('', '### D) Všechny měřené běhy (p95 v ms)', '', '| workflow běh | druh | CPU | verze | běh | page | plan | hold | checkout | pay | webhook | 5xx | chyby | konzistence |', '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const x of all) {
  const s5 = STEPS.reduce((a, s) => a + (x.steps[s].s5xx ?? 0) + x.steps[s].s503final, 0);
  const er = STEPS.reduce((a, s) => a + x.steps[s].errors, 0);
  const c = x.consistency.after;
  L.push(`| ${x.id} | ${x.kind} | ${x.cpu} | ${x.next} | ${x.run} | ${STEPS.map((s) => Math.round(x.steps[s].p95)).join(' | ')} | ${s5} | ${er} | ${x.consistency.ok ? 'OK' : 'CHYBA'} ${c.soldSeats}/${c.paidItems}/${c.ticketsOnPaid}, 2× ${c.seatInTwoPaidItems}/${c.seatInTwoTickets}, holdy ${c.heldSeats}, pending ${c.pendingOrders} |`);
}
L.push('', `Konzistence: ${all.filter((x) => x.consistency.ok).length}/${all.length} OK; 5xx celkem ${all.reduce((a, x) => a + STEPS.reduce((b, s) => b + (x.steps[s].s5xx ?? 0) + x.steps[s].s503final, 0), 0)}; chyby celkem ${all.reduce((a, x) => a + STEPS.reduce((b, s) => b + x.steps[s].errors, 0), 0)}.`);
console.log(L.join('\n'));
