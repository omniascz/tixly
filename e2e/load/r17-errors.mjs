/**
 * Kolo 17 — chyby po krocích z k6 `--out json` (body metrik err_* a s503final_* se štítkem status).
 *   node load/r17-errors.mjs points.json > errors.json
 * Výstup: { <krok>: { errors, s5xx, network, other, s503final, byStatus: { "<kód>": n } } }
 * s5xx = odpovědi 500–599 mimo řízené 503 s Retry-After (ty jsou v s503final), network = status 0 (spojení / timeout).
 */
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

const STEPS = ['page', 'plan', 'hold', 'checkout', 'pay', 'webhook'];
const out = Object.fromEntries(STEPS.map((s) => [s, { errors: 0, s5xx: 0, network: 0, other: 0, s503final: 0, byStatus: {} }]));
const rl = createInterface({ input: createReadStream(process.argv[2]), crlfDelay: Infinity });
for await (const line of rl) {
  if (!line.includes('"type":"Point"')) continue;
  const p = JSON.parse(line);
  const m = /^(err|s503final)_(\w+)$/.exec(p.metric);
  if (!m || !out[m[2]]) continue;
  const o = out[m[2]];
  const n = p.data.value;
  if (m[1] === 's503final') { o.s503final += n; continue; }
  const st = Number(p.data.tags?.status ?? -1);
  o.errors += n;
  o.byStatus[st] = (o.byStatus[st] ?? 0) + n;
  if (st >= 500 && st <= 599) o.s5xx += n; else if (st === 0) o.network += n; else o.other += n;
}
process.stdout.write(JSON.stringify(out));
