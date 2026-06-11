/**
 * E2E: tištěná vstupenka (104mm) → print token → scanner admit → print-labels PDF.
 * Spouštět proti běžícímu dev serveru na :3000. Nepoužívá Next env auto-load,
 * tak si .env.local načteme ručně (kvůli DATABASE_URL + JWT_SECRET pro podpis).
 */
import { readFileSync } from 'node:fs';
import pg from 'pg';

// --- ruční load .env.local (jen co potřebujeme) ---
for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

const BASE = 'http://localhost:3000';
const PASSWORD = 'Demo2026!';

function log(step: string, ok: boolean, detail: string) {
  process.stdout.write(`${ok ? '✅' : '❌'} ${step} — ${detail}\n`);
}

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// 1) Najdi validní lístek + e-mail člena promotéra (bez 2FA), static QR policy.
// RLS je ENFORCED (tixly_rls_test NOBYPASSRLS) → discovery běží v admin kontextu
// (stejně jako runWithServiceContext v appce).
const dc = await pool.connect();
await dc.query('BEGIN');
await dc.query(`SET LOCAL app.is_platform_admin = 'true'`);
const disc = await dc.query<{
  ticket_id: string;
  order_id: string;
  qr_policy: string | null;
  promoter_id: string;
  member_email: string;
}>(
  `SELECT t.id AS ticket_id, t.order_id, e.qr_policy, e.promoter_id, u.email AS member_email
     FROM tickets.tickets t
     JOIN orders.orders o ON o.id = t.order_id
     JOIN catalog.events e ON e.id = o.event_id
     JOIN platform.promoter_members pm ON pm.promoter_id = e.promoter_id
     JOIN identity.users u ON u.id = pm.user_id
     LEFT JOIN identity.user_2fa f ON f.user_id = u.id AND f.enabled = true
    WHERE t.status = 'valid'
      AND COALESCE(e.qr_policy, 'static_allowed') = 'static_allowed'
      AND f.user_id IS NULL
    ORDER BY t.created_at DESC
    LIMIT 1`,
);
await dc.query('ROLLBACK');
dc.release();
if (disc.rows.length === 0) {
  log('discovery', false, 'žádný validní lístek se static QR + člen bez 2FA nenalezen');
  await pool.end();
  process.exit(1);
}
const c = disc.rows[0];
log('discovery', true, `ticket=${c.ticket_id.slice(0, 8)} order=${c.order_id.slice(0, 8)} promoter member=${c.member_email} qr_policy=${c.qr_policy ?? 'null'}`);

// 2) Login
const loginRes = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: c.member_email, password: PASSWORD }),
});
const loginJson = (await loginRes.json().catch(() => ({}))) as { accessToken?: string; error?: string };
if (!loginRes.ok || !loginJson.accessToken) {
  log('login', false, `HTTP ${loginRes.status} ${loginJson.error ?? ''}`);
  await pool.end();
  process.exit(1);
}
const token = loginJson.accessToken;
log('login', true, `accessToken získán (${token.slice(0, 12)}…)`);
const authHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

// 3) Podepiš print token (stejný env jako server → shoda podpisu)
const { signPrintToken } = await import('../src/lib/tickets/print-token');
const printToken = signPrintToken(c.ticket_id);
log('sign', true, `${printToken} (len ${printToken.length})`);

// 4) Scanner validate s printTokenem → očekáváme admitted
const v1 = await fetch(`${BASE}/api/admin/scanner/validate`, {
  method: 'POST',
  headers: authHeaders,
  body: JSON.stringify({ printToken }),
});
const v1j = (await v1.json().catch(() => ({}))) as { result?: string; ticket?: { eventTitle?: string } };
log('validate #1', v1j.result === 'admitted', `HTTP ${v1.status} result=${v1j.result} event="${v1j.ticket?.eventTitle ?? '?'}"`);

// 5) Druhý sken stejného tokenu → idempotence (already_used)
const v2 = await fetch(`${BASE}/api/admin/scanner/validate`, {
  method: 'POST',
  headers: authHeaders,
  body: JSON.stringify({ printToken }),
});
const v2j = (await v2.json().catch(() => ({}))) as { result?: string };
log('validate #2', v2j.result === 'already_used', `HTTP ${v2.status} result=${v2j.result} (čekáme already_used)`);

// 6) Tamper test — přehoď poslední znak → invalid_token
const bad = printToken.slice(0, -1) + (printToken.slice(-1) === 'A' ? 'B' : 'A');
const v3 = await fetch(`${BASE}/api/admin/scanner/validate`, {
  method: 'POST',
  headers: authHeaders,
  body: JSON.stringify({ printToken: bad }),
});
const v3j = (await v3.json().catch(() => ({}))) as { result?: string };
log('validate tamper', v3.status === 401 && v3j.result === 'invalid_token', `HTTP ${v3.status} result=${v3j.result} (čekáme 401 invalid_token)`);

// 7) Print-labels PDF
const pl = await fetch(`${BASE}/api/admin/orders/${c.order_id}/print-labels`, { headers: authHeaders });
const ct = pl.headers.get('content-type') ?? '';
const buf = Buffer.from(await pl.arrayBuffer());
const isPdf = pl.ok && ct.includes('application/pdf') && buf.subarray(0, 5).toString('latin1') === '%PDF-';
const mb = buf.toString('latin1').match(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/);
log('print-labels', isPdf, `HTTP ${pl.status} ct=${ct} bytes=${buf.length} MediaBox=${mb ? mb[1] + 'x' + mb[2] : 'n/a'}`);

await pool.end();
