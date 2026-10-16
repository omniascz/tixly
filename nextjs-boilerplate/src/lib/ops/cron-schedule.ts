/**
 * Kolo 14 / krok 3 — registr cronů a jejich intervaly (pro heartbeat a kontrolní job).
 *
 * Zdroj pravdy = vercel.json (crons) + záloha DB z GitHub Actions (.github/workflows/db-backup.yml, neděle 4:00 UTC).
 * Interval = NEJDELŠÍ mezera mezi dvěma po sobě jdoucími běhy výrazu (UTC) — kontrolní job hlásí cron, který neproběhl
 * déle než 2× interval. Parser zná běžný zápis cronu: *, *\/n, a-b, a-b/n, seznamy; den v měsíci a den v týdnu se
 * (jako v cronu) kombinují NEBO, když jsou omezené oba.
 */
import vercelConfig from '../../../vercel.json';

type Field = Set<number>;

function parseField(spec: string, min: number, max: number): Field {
  const out = new Set<number>();
  for (const part of spec.split(',')) {
    const [range, stepStr] = part.split('/');
    const step = stepStr ? Number(stepStr) : 1;
    let lo = min; let hi = max;
    if (range !== '*') {
      const [a, b] = range.split('-');
      lo = Number(a);
      hi = b !== undefined ? Number(b) : stepStr ? max : lo;
    }
    if (!Number.isInteger(lo) || !Number.isInteger(hi) || !Number.isInteger(step) || step <= 0 || lo < min || hi > max) {
      throw new Error(`Neplatný výraz cronu: ${spec}`);
    }
    for (let v = lo; v <= hi; v += step) out.add(v);
  }
  return out;
}

const cache = new Map<string, number>();

/** Nejdelší mezera mezi běhy výrazu cronu v minutách (UTC, okno 1. 1.–3. 3. 2026 = pokryje i měsíční joby). */
export function cronIntervalMinutes(expr: string): number {
  const hit = cache.get(expr);
  if (hit) return hit;
  const [mi, ho, dom, mo, dow] = expr.trim().split(/\s+/);
  const minutes = parseField(mi, 0, 59);
  const hours = parseField(ho, 0, 23);
  const doms = parseField(dom, 1, 31);
  const months = parseField(mo, 1, 12);
  const dows = parseField(dow.replace(/\b7\b/g, '0'), 0, 6);
  const domRestricted = dom !== '*';
  const dowRestricted = dow !== '*';
  const start = Date.UTC(2026, 0, 1);
  const end = Date.UTC(2026, 2, 3);
  let prev: number | null = null;
  let maxGap = 0;
  for (let t = start; t < end; t += 60_000) {
    const d = new Date(t);
    if (!minutes.has(d.getUTCMinutes()) || !hours.has(d.getUTCHours()) || !months.has(d.getUTCMonth() + 1)) continue;
    const domOk = doms.has(d.getUTCDate());
    const dowOk = dows.has(d.getUTCDay());
    const dayOk = domRestricted && dowRestricted ? domOk || dowOk : domOk && dowOk;
    if (!dayOk) continue;
    if (prev !== null) maxGap = Math.max(maxGap, (t - prev) / 60_000);
    prev = t;
  }
  if (!maxGap) throw new Error(`Výraz cronu nikdy neběží: ${expr}`);
  cache.set(expr, maxGap);
  return maxGap;
}

export interface CronEntry { job: string; path: string; schedule: string; intervalMinutes: number }

/** Mimo vercel.json: záloha DB běží v GitHub Actions a hlásí se na /api/ops/backup-status. */
const EXTERNAL_CRONS = [{ job: 'db-backup', path: '.github/workflows/db-backup.yml', schedule: '0 4 * * 0' }];

/** Název jobu z cesty cronu: /api/cron/dispatch?job=X → X; jinak poslední dva segmenty cesty (lastminute-check). */
export function cronJobName(path: string): string {
  const q = /[?&]job=([^&]+)/.exec(path);
  if (q) return decodeURIComponent(q[1]);
  return path.split('?')[0].split('/').filter(Boolean).slice(-2).join('-');
}

export function cronRegistry(): CronEntry[] {
  const crons = ((vercelConfig as { crons?: Array<{ path: string; schedule: string }> }).crons ?? []);
  return [...crons, ...EXTERNAL_CRONS].map((c) => ({
    job: 'job' in c ? (c as { job: string }).job : cronJobName(c.path),
    path: c.path,
    schedule: c.schedule,
    intervalMinutes: cronIntervalMinutes(c.schedule),
  }));
}

export function cronEntry(job: string): CronEntry | undefined {
  return cronRegistry().find((c) => c.job === job);
}
