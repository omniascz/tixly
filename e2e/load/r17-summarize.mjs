/**
 * Kolo 17 — souhrn zátěžových běhů z workflow loadtest.yml.
 *
 *   node load/r17-summarize.mjs <adresář výstupů> > results.json        JSON (runner, běhy, mediány p95)
 *   node load/r17-summarize.mjs --md results.json [další.json …]        tabulky Markdown (Job Summary / report)
 *   node load/r17-summarize.mjs --gate results.json <base> <cand> [max] [minMs]
 *       exit 1, když se medián p95 kteréhokoli kroku zhorší o víc než max (0.20) — a zároveň o víc než minMs (25 ms,
 *       šum u kroků s p95 v jednotkách ms) — nebo když selže konzistence (přeprodej, osiřelé holdy, nesoulad počtů)
 *   node load/r17-summarize.mjs --check results.json                    exit 1 jen při selhání konzistence
 * Odpovědi 5xx bránu neshazují (vypíší se jako WARN) — cíl „žádná 5xx" se hodnotí v reportu.
 * Adresář: meta_<štítek>.json, summary_<štítek>_<i>.json (k6 --summary-export), errors_<štítek>_<i>.json
 * (r17-errors.mjs), consistency_<štítek>_<i>.json (r14-consistency.mjs), runner.json. Zahřívací běh se nepočítá.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const STEPS = ['page', 'plan', 'hold', 'checkout', 'pay', 'webhook'];
const TARGET_MS = { hold: 1500, checkout: 1500 }; // cíl kola 14: p95 holdu a checkoutu pod 1,5 s
const rd = (f) => JSON.parse(readFileSync(f, 'utf8'));
const median = (a) => { const s = a.filter((x) => x != null).sort((x, y) => x - y); if (!s.length) return null; const h = s.length >> 1; return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2; };
const ms = (v) => (v == null ? '—' : v >= 1000 ? `${(v / 1000).toFixed(2)} s` : `${Math.round(v)} ms`);

function collect(dir) {
  const runner = existsSync(join(dir, 'runner.json')) ? rd(join(dir, 'runner.json')) : null;
  const versions = readdirSync(dir).filter((f) => /^meta_.+\.json$/.test(f)).map((f) => rd(join(dir, f)));
  const runs = [];
  for (const v of versions) {
    for (let i = 1; i <= v.runs; i++) {
      const name = `${v.label}_${i}`;
      const sf = join(dir, `summary_${name}.json`);
      if (!existsSync(sf)) { runs.push({ label: v.label, run: i, missing: true }); continue; }
      const m = rd(sf).metrics;
      const c = (k) => m[k]?.count ?? 0;
      const ef = join(dir, `errors_${name}.json`);
      const e = existsSync(ef) ? rd(ef) : null;
      const cf = join(dir, `consistency_${name}.json`);
      let cons = null;
      try { cons = rd(cf); } catch { cons = null; }
      const steps = {};
      for (const s of STEPS) {
        const t = m[`t_${s}`] ?? {};
        const n = t.count ?? 0;
        const err = c(`err_${s}`);
        steps[s] = {
          p50: t['p(50)'] ?? null, p95: t['p(95)'] ?? null, p99: t['p(99)'] ?? null, count: n,
          errors: err, errorRate: n ? err / n : 0,
          s5xx: e ? e[s].s5xx : null, network: e ? e[s].network : null, byStatus: e ? e[s].byStatus : null,
          s503retried: c(`s503_${s}`), s503final: c(`s503final_${s}`),
        };
      }
      runs.push({
        label: v.label, run: i, sha: v.sha, next: v.next, steps,
        boughtSeats: c('bought_seats'), holdConflict: c('hold_conflict'), soldOut: c('sold_out'), harnessRetryPay: c('harness_retry_pay'),
        consistency: cons ? { ok: cons.ok, checks: cons.checks, after: cons.after } : { ok: false, error: 'konzistence chybí / neplatný JSON' },
      });
    }
  }
  const medians = {};
  for (const v of versions) {
    const rs = runs.filter((r) => r.label === v.label && !r.missing);
    medians[v.label] = { sha: v.sha, next: v.next, runs: rs.length, p95: Object.fromEntries(STEPS.map((s) => [s, median(rs.map((r) => r.steps[s].p95))])) };
  }
  return { runner, versions, runs, medians };
}

function mdRuns(res) {
  const L = [];
  if (res.runner) {
    const r = res.runner;
    L.push(`**Runner:** ${r.cpuModel} · ${r.cpus} vCPU · ${r.memTotalGb} GB RAM · ${r.os} · kernel ${r.kernel} · Node ${r.node} · ${r.runnerName ?? ''} (${r.imageVersion ?? 'image ?'})`, '');
  }
  for (const run of res.runs) {
    if (run.missing) { L.push(`### ${run.label} běh ${run.run} — CHYBÍ výsledek`, ''); continue; }
    L.push(`### ${run.label} běh ${run.run} (next ${run.next}, ${run.sha.slice(0, 8)})`, '',
      '| krok | p50 | p95 | p99 | požadavků | chyby (5xx / síť / jiné) | chybovost | řízené 503 (opak. / i po opak.) |', '|---|---|---|---|---|---|---|---|');
    for (const s of STEPS) {
      const x = run.steps[s];
      L.push(`| ${s} | ${ms(x.p50)} | ${ms(x.p95)} | ${ms(x.p99)} | ${x.count} | ${x.errors} (${x.s5xx ?? '?'} / ${x.network ?? '?'} / ${x.errors - (x.s5xx ?? 0) - (x.network ?? 0)}) | ${(100 * x.errorRate).toFixed(1)} % | ${x.s503retried} / ${x.s503final} |`);
    }
    const a = run.consistency.after;
    L.push('', `prodáno míst ${run.boughtSeats}, kolize holdu (409) ${run.holdConflict}, vyprodáno ${run.soldOut}`,
      a ? `konzistence: **${run.consistency.ok ? 'OK' : 'CHYBA'}** — prodaná místa ${a.soldSeats}, zaplacené položky ${a.paidItems}, vstupenky ${a.ticketsOnPaid}, místo 2× ${a.seatInTwoPaidItems}/${a.seatInTwoTickets}, osiřelé holdy ${a.heldSeats}, pending po expiraci ${a.pendingOrders}`
        : `konzistence: **CHYBA** — ${run.consistency.error}`, '');
  }
  return L;
}

function mdMedians(list) {
  // mediány p95 přes všechny běhy všech předaných výsledků, po štítku verze
  const byLabel = {};
  for (const res of list) for (const run of res.runs) if (!run.missing) (byLabel[run.label] ??= []).push(run);
  const labels = Object.keys(byLabel);
  const L = ['### Medián p95 po krocích', '', `| krok | ${labels.map((l) => `${l} (${byLabel[l].length} běhů)`).join(' | ')} | cíl kola 14 |`, `|---|${labels.map(() => '---').join('|')}|---|`];
  for (const s of STEPS) {
    const vals = labels.map((l) => median(byLabel[l].map((r) => r.steps[s].p95)));
    L.push(`| ${s} | ${vals.map(ms).join(' | ')} | ${TARGET_MS[s] ? `< ${ms(TARGET_MS[s])}` : '—'} |`);
  }
  return L;
}

function gate(res, base, cand, max, minMs) {
  const fails = [];
  if (base) {
    const mb = res.medians[base]?.p95; const mc = res.medians[cand]?.p95;
    if (!mb || !mc) fails.push(`chybí výsledky verze ${!mb ? base : cand}`);
    else for (const s of STEPS) {
      if (mb[s] == null || mc[s] == null) { fails.push(`${s}: chybí p95`); continue; }
      const d = (mc[s] - mb[s]) / mb[s];
      const line = `${s}: medián p95 ${base} ${ms(mb[s])} → ${cand} ${ms(mc[s])} (${d >= 0 ? '+' : ''}${(100 * d).toFixed(1)} %, ${mc[s] - mb[s] >= 0 ? '+' : ''}${Math.round(mc[s] - mb[s])} ms)`;
      if (d > max && mc[s] - mb[s] > minMs) fails.push(`zhoršení ${line}`); else console.log(`ok   ${line}`);
    }
  }
  for (const r of res.runs) {
    if (r.missing) { fails.push(`${r.label} běh ${r.run}: chybí výsledek`); continue; }
    const s5xx = STEPS.reduce((a, s) => a + (r.steps[s].s5xx ?? 0) + r.steps[s].s503final, 0);
    if (!r.consistency.ok) fails.push(`${r.label} běh ${r.run}: konzistence selhala ${JSON.stringify(r.consistency.checks ?? r.consistency.error)}`);
    else console.log(`ok   ${r.label} běh ${r.run}: konzistence OK`);
    if (s5xx) console.log(`WARN ${r.label} běh ${r.run}: ${s5xx}× odpověď 5xx`);
  }
  for (const f of fails) console.log(`FAIL ${f}`);
  return fails.length ? 1 : 0;
}

const a = process.argv.slice(2);
if (a[0] === '--md') {
  const list = a.slice(1).map(rd);
  console.log([...list.flatMap(mdRuns), ...mdMedians(list)].join('\n'));
} else if (a[0] === '--gate') {
  process.exitCode = gate(rd(a[1]), a[2], a[3], Number(a[4] ?? 0.2), Number(a[5] ?? 25));
} else if (a[0] === '--check') {
  process.exitCode = gate(rd(a[1]), null, null, 0, 0);
} else {
  process.stdout.write(JSON.stringify(collect(a[0]), null, 2));
}
