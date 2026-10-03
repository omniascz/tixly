// Mutacni sonda: v ODDELENEM worktree ../tixly-mut (detached HEAD) zamerne rozbije logiku
// kriticke funkce, pusti unit sadu (vitest.config.ts) + live sadu (audit config proti izolovane DB),
// zaznamena, zda nektery test zcervenal, a soubor VRATI pres `git checkout -- <file>`.
// Pouziti: node audit/tools/mutation-probe.mjs [id...]
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { execSync, spawnSync } from 'node:child_process';
import path from 'node:path';

const MUT = 'C:/Users/omnia/Documents/tixly-mut';
const NB = `${MUT}/nextjs-boilerplate`;
const AUDIT = 'C:/Users/omnia/Documents/tixly-audit/audit';
const OUT = `${AUDIT}/logs/11_mutation_probe.log`;

const MUTATIONS = [
  {
    id: 'M1-totp-window',
    file: 'src/lib/totp/verify.ts',
    what: 'TOTP okno ±1 krok -> ±100 kroku (prijme kod stary ~50 min = replay screenshotu)',
    from: 'const DEFAULT_WINDOW = 1;',
    to: 'const DEFAULT_WINDOW = 100;',
  },
  {
    id: 'M2-mock-guard',
    file: 'src/lib/payment/mock-guard.ts',
    what: 'mock platby povoleny i v produkci (vstupenky zdarma)',
    from: "return process.env.NODE_ENV !== 'production' || process.env.ALLOW_MOCK_PAYMENTS === '1';",
    to: 'return true;',
  },
  {
    id: 'M3-gopay-amount',
    file: 'src/app/api/payments/gopay/webhook/route.ts',
    what: 'GoPay webhook: kontrola zaplacene castky vypnuta (underpayment -> paid)',
    from: ': paidAmount >= order.total_amount;',
    to: ': true;',
  },
  {
    id: 'M4-checkout-oversell',
    file: 'src/app/api/checkout/route.ts',
    what: 'checkout: atomicky odpocet bez podminky remaining_qty >= qty (preprodej)',
    from: 'WHERE id = $2 AND remaining_qty >= $1',
    to: 'WHERE id = $2',
  },
  {
    id: 'M5-issuer-idempotency',
    file: 'src/lib/tickets/demo-issuer.ts',
    what: 'issuer: bez advisory locku, bez idempotentni kontroly (existing), ticket_seq nahodny -> dvoji vystaveni',
    multi: [
      ["await db.query(`SELECT pg_advisory_xact_lock(hashtext('issue-tickets:' || $1::text))`, [orderId]);", '/* M5 lock removed */'],
      ['if (existing.rows.length > 0) {', 'if (false && existing.rows.length > 0) {'],
      ['          seq,\n        ],', '          seq + 1 + Math.floor(Math.random() * 1e9),\n        ],'],
    ],
  },
  {
    id: 'M6-resolve-price',
    file: 'src/lib/pricing/resolve-price.ts',
    what: 'kontrola: dobre pokryty modul (95 %) — finalize() vrati o 1 halir nizsi cenu',
    from: '    throw new PriceMismatchError(price.unitPriceHalire, expected);\n  }\n  return price;',
    to: '    throw new PriceMismatchError(price.unitPriceHalire, expected);\n  }\n  return { ...price, unitPriceHalire: price.unitPriceHalire - 1 };',
  },
];

function run(cmd, args, env = {}) {
  const r = spawnSync(cmd, args, { cwd: NB, env: { ...process.env, ...env }, encoding: 'utf8', shell: true, maxBuffer: 1 << 28 });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');
function summarize(out) {
  const o = strip(out);
  const files = (o.match(/Test Files\s+([^\n]+)/) || [])[1] || '?';
  const tests = (o.match(/\n\s+Tests\s+([^\n]+)/) || [])[1] || '?';
  const failed = [...o.matchAll(/FAIL\s+(tests\/[^\n]+|src\/[^\n]+)/g)].map((m) => m[1].trim()).slice(0, 8);
  return { files: files.trim(), tests: tests.trim(), failed };
}

const only = process.argv.slice(2);
appendFileSync(OUT, `\n===== mutation probe ${new Date().toISOString()} =====\n`);
for (const m of MUTATIONS) {
  if (only.length && !only.includes(m.id)) continue;
  const fp = path.join(NB, m.file);
  execSync(`git -C ${MUT} checkout -- nextjs-boilerplate/${m.file}`);
  const orig = readFileSync(fp, 'utf8');
  const crlf = orig.includes('\r\n');
  let s = orig.replace(/\r\n/g, '\n');
  const pairs = m.multi ?? (m.dynamic ? null : [[m.from, m.to]]);
  if (m.dynamic) {
    // resolve-price: najdi prvni `return {` s cenou a odecti 1 — konkretni kotva se vypise
    const anchor = s.match(/priceHalire:\s*([A-Za-z_][\w.]*)/);
    if (!anchor) throw new Error('M6 anchor not found');
    s = s.replace(anchor[0], `priceHalire: (${anchor[1]}) - 1`);
    m.what += ` [kotva: "${anchor[0]}"]`;
  } else {
    for (const [a, b] of pairs) {
      if (!s.includes(a)) throw new Error(`${m.id}: anchor missing: ${a}`);
      s = s.replace(a, b);
    }
  }
  writeFileSync(fp, crlf ? s.replace(/\n/g, '\r\n') : s);
  const diff = execSync(`git -C ${MUT} diff --stat -- nextjs-boilerplate/${m.file}`, { encoding: 'utf8' }).trim();

  const unit = summarize(run('npx', ['vitest', 'run', '--config', 'vitest.config.ts']).out);
  const live = summarize(run('npx', ['vitest', 'run', '--config', `${AUDIT}/live/vitest.audit-live.config.ts`], { AUDIT_NB_ROOT: NB, NEON_API_KEY: '' }).out);

  execSync(`git -C ${MUT} checkout -- nextjs-boilerplate/${m.file}`);
  const clean = execSync(`git -C ${MUT} status --porcelain -- nextjs-boilerplate/src`, { encoding: 'utf8' }).trim();

  const rec = { id: m.id, what: m.what, diff, unit, live, revertedClean: clean === '' };
  console.log(JSON.stringify(rec, null, 1));
  appendFileSync(OUT, JSON.stringify(rec) + '\n');
}
