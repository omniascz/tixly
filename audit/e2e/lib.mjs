// Spolecna knihovna E2E auditu. Aplikace bezi na BASE (next start, izolovana DB).
// Ground truth se cte primo z DB pres OWNER spojeni (bypass RLS) — nikdy z odpovedi aplikace.
import pg from 'pg';
import { appendFileSync, writeFileSync } from 'node:fs';

export const BASE = process.env.AUDIT_BASE ?? 'http://localhost:3100';
export const OWNER_URL = process.env.AUDIT_OWNER_URL ?? 'postgresql://neondb_owner:auditowner@localhost:55432/e2e';
export const GOPAY = process.env.FAKE_GOPAY ?? 'http://localhost:3999';
export const MAILPIT = process.env.MAILPIT ?? 'http://localhost:58025';
export const INTERNAL_TOKEN = process.env.INTERNAL_SERVICE_TOKEN ?? 'audit-internal-token-0123456789abcdef';

export const owner = new pg.Pool({ connectionString: OWNER_URL, max: 4 });
export const q = async (sql, params) => (await owner.query(sql, params)).rows;

// Kolo 2: start sekvence je nahodny — kazdy beh skriptu (novy proces) by jinak znovu
// pouzil tytez IP a narazil na per-IP rate limit checkoutu (K3: 10 / 10 min) z PREDCHOZIHO behu.
let ipSeq = Math.floor(Math.random() * 4_000_000);
/** Unikatni IP na klienta (rate-limit je per IP) — x-real-ip / x-forwarded-for. */
export const nextIp = () => { const n = ipSeq++; return `10.${(n >> 16) & 63 | 64}.${(n >> 8) & 255}.${(n & 255) || 1}`; };

export class Client {
  constructor(name) { this.name = name; this.cookies = new Map(); this.ip = nextIp(); this.token = null; }
  cookieHeader() { return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '); }
  async req(method, path, body, headers = {}) {
    const h = { 'x-real-ip': this.ip, 'x-forwarded-for': this.ip, ...headers };
    if (body !== undefined && !(typeof body === 'string')) h['content-type'] = 'application/json';
    if (this.cookies.size) h.cookie = this.cookieHeader();
    // Kolo 3 (K5 CSRF): klient emuluje prohlížeč — fetch v prohlížeči posílá u stavových metod
    // vždy Origin. Skript ho může přepsat (K5 posílá cizí Origin záměrně).
    if (!['GET', 'HEAD'].includes(method) && !Object.keys(headers).some((k) => k.toLowerCase() === 'origin')) h.origin = new URL(BASE).origin;
    const res = await fetch(BASE + path, { method, headers: h, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body), redirect: 'manual', signal: AbortSignal.timeout(Number(process.env.AUDIT_HTTP_TIMEOUT ?? 60000)) });
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const [kv] = c.split(';'); const i = kv.indexOf('=');
      const k = kv.slice(0, i), v = kv.slice(i + 1);
      if (v === '' || /max-age=0/i.test(c)) this.cookies.delete(k); else this.cookies.set(k, v);
    }
    const text = await res.text();
    let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
    return { status: res.status, json, text, headers: res.headers };
  }
  get(p, h) { return this.req('GET', p, undefined, h); }
  post(p, b, h) { return this.req('POST', p, b ?? {}, h); }
  patch(p, b, h) { return this.req('PATCH', p, b ?? {}, h); }
  put(p, b, h) { return this.req('PUT', p, b ?? {}, h); }
  del(p, h) { return this.req('DELETE', p, undefined, h); }
}

// ---- evidence log -----------------------------------------------------------
const results = [];
let LOGFILE = null;
export function startLog(name) {
  LOGFILE = new URL(`../logs/${process.env.AUDIT_LOG_PREFIX ?? ''}e2e_${name}.jsonl`, import.meta.url);
  writeFileSync(LOGFILE, '');
  console.log(`# E2E ${name}  base=${BASE}  ${new Date().toISOString()}`);
}
const short = (v) => { const s = typeof v === 'string' ? v : JSON.stringify(v); return s && s.length > 400 ? s.slice(0, 400) + '…' : s; };
/** Zaznam kontroly. ok=true/false/null(null = NEOVERENO/info). */
export function check(id, title, ok, evidence) {
  const rec = { id, title, result: ok === true ? 'PASS' : ok === false ? 'FAIL' : 'INFO', evidence };
  results.push(rec);
  if (LOGFILE) appendFileSync(LOGFILE, JSON.stringify(rec) + '\n');
  console.log(`${rec.result.padEnd(4)} ${id}  ${title}\n       ${short(evidence)}`);
  return ok;
}
export function summary() {
  const c = { PASS: 0, FAIL: 0, INFO: 0 };
  for (const r of results) c[r.result]++;
  console.log(`\n# SUMMARY ${JSON.stringify(c)}`);
  for (const r of results.filter((x) => x.result === 'FAIL')) console.log(`  FAIL ${r.id} ${r.title}`);
  return c;
}
export const ev = (r) => ({ status: r.status, body: short(r.json ?? r.text) });

// ---- fake GoPay + mailpit ---------------------------------------------------
export const gopayCtl = async (id, body) => (await fetch(`${GOPAY}/_ctl/${id}`, { method: 'POST', body: JSON.stringify(body) })).json();
export const gopayLog = async () => (await fetch(`${GOPAY}/_ctl/log`)).json();
export const gopayPayments = async () => (await fetch(`${GOPAY}/_ctl/payments`)).json();
export async function mails(query) {
  const r = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(query)}&limit=200`);
  return (await r.json()).messages ?? [];
}
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export async function waitFor(fn, ms = 15000, step = 500) {
  const t = Date.now();
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t > ms) return v; await sleep(step); }
}

// ---- kolo 2: unikatni kupec na scenar --------------------------------------
// Checkout ma od K3 per-e-mail limit (max 5 soucasne zivych pending objednavek na e-mail)
// a per-IP limit (10 / 10 min). Skripty psane pred K3 hromadily nezaplacene objednavky na
// JEDEN e-mail (S.buyerEmail) a z JEDNE IP -> 429 nesouvisejici s testovanou vlastnosti.
// Kazdy scenar proto dostane vlastniho zaregistrovaneho a prihlaseneho kupce (vlastni
// e-mail i IP). Objednavka zalozena s buyerEmail = jeho e-mail patri jemu (createOrGetGuestUser
// vraci existujiciho uzivatele), takze vlastnicke kontroly (PDF, storno, refund) plati.
export async function scenarioBuyer(S, tag) {
  const email = `buyer-${String(tag).toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${S.run}@audit.test`;
  const c = new Client(`buyer-${tag}`);
  const reg = await c.post('/api/auth/register', { email, password: S.pw, name: `Kupec ${tag}` });
  if (reg.status !== 200 && reg.status !== 409) throw new Error(`scenarioBuyer register ${email} ${reg.status} ${reg.text}`);
  const lg = await c.post('/api/auth/login', { email, password: S.pw });
  if (lg.status !== 200) throw new Error(`scenarioBuyer login ${email} ${lg.status} ${lg.text}`);
  const id = (await q(`SELECT id FROM identity.users WHERE lower(email)=lower($1)`, [email]))[0]?.id;
  return { c, email, id };
}
