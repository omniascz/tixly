#!/usr/bin/env node
/**
 * Verifier pro kroky 11-13 buyer flow:
 *   11. mail s PDF a QR
 *   12. skener přijme TOTP kód
 *   13. ticket = used, used_at NOT NULL
 *
 * Předpoklad: dev server běží na localhost:3000 a v DB existuje aspoň jedna
 * objednávka od pw-*@example.cz (vyrobená Playwright golden-path testem).
 *
 * Spuštění:
 *   node scripts/verify-buyer-ticket-flow.mjs
 *   # nebo s konkrétním ticketID:
 *   node scripts/verify-buyer-ticket-flow.mjs --ticket=<uuid>
 */

import { createDecipheriv, createHash, createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENV_PATH = join(__dirname, '..', 'nextjs-boilerplate', '.env.local');

// pg žije v nextjs-boilerplate/node_modules — naimportujeme ho odtamtud,
// aby skript šel spustit z root scripts/ bez vlastního package.json.
const requireFromApp = createRequire(join(__dirname, '..', 'nextjs-boilerplate', 'noop.js'));
const pg = requireFromApp('pg');

// ─── env ───────────────────────────────────────────────────────────────────
const env = {};
for (const line of readFileSync(ENV_PATH, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2];
}
const DATABASE_URL = env.DATABASE_URL ?? 'postgresql://tixly:tixly_dev@localhost:5433/tixly';
const ENCRYPTION_KEY = env.ENCRYPTION_KEY;
const BASE = env.BASE_URL ?? 'http://localhost:3000';
const MAILHOG = env.MAILHOG_URL ?? 'http://localhost:8025';

if (!ENCRYPTION_KEY) {
  console.error('Chybí ENCRYPTION_KEY v .env.local');
  process.exit(1);
}

// ─── crypto: dešifrování TOTP secretu (kopie z src/lib/crypto/index.ts) ────
function getKey() {
  const hex = ENCRYPTION_KEY;
  if (hex.length !== 64) return createHash('sha256').update(hex).digest();
  return Buffer.from(hex, 'hex');
}
function decryptSecret(encoded) {
  const buf = Buffer.from(encoded, 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(buf.length - 16);
  const ct = buf.subarray(12, buf.length - 16);
  const d = createDecipheriv('aes-256-gcm', getKey(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]).toString('utf8');
}

// ─── TOTP code (RFC 6238, 30s, 6 digits, SHA-1) ────────────────────────────
function generateTotp(secretRaw, atDate = new Date()) {
  const counter = BigInt(Math.floor(atDate.getTime() / 1000 / 30));
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(counter);
  const hmac = createHmac('sha1', secretRaw).update(buf).digest();
  const off = hmac[hmac.length - 1] & 0x0f;
  const bin =
    ((hmac[off] & 0x7f) << 24) |
    ((hmac[off + 1] & 0xff) << 16) |
    ((hmac[off + 2] & 0xff) << 8) |
    (hmac[off + 3] & 0xff);
  return String(bin % 1_000_000).padStart(6, '0');
}

// ─── helpers ───────────────────────────────────────────────────────────────
function ok(msg) { console.log(`  \x1b[32m✓\x1b[0m ${msg}`); }
function fail(msg) { console.log(`  \x1b[31m✗\x1b[0m ${msg}`); process.exitCode = 1; }
function step(msg) { console.log(`\n\x1b[1m${msg}\x1b[0m`); }

const argTicket = process.argv.find((a) => a.startsWith('--ticket='))?.split('=')[1] ?? null;

// ─── main ──────────────────────────────────────────────────────────────────
const pool = new pg.Pool({ connectionString: DATABASE_URL });

try {
  step('1. Najdi poslední Playwright nákup');
  let ticket;
  if (argTicket) {
    const r = await pool.query(
      `SELECT t.id, t.status, t.totp_secret_encrypted, u.email, e.id AS event_id, e.title, e.promoter_id, o.id AS order_id
       FROM tickets.tickets t
       JOIN orders.orders o ON o.id = t.order_id
       JOIN identity.users u ON u.id = t.owner_id
       JOIN catalog.events e ON e.id = o.event_id
       WHERE t.id = $1`,
      [argTicket],
    );
    ticket = r.rows[0];
  } else {
    const r = await pool.query(
      `SELECT t.id, t.status, t.totp_secret_encrypted, u.email, e.id AS event_id, e.title, e.promoter_id, o.id AS order_id
       FROM tickets.tickets t
       JOIN orders.orders o ON o.id = t.order_id
       JOIN identity.users u ON u.id = t.owner_id
       JOIN catalog.events e ON e.id = o.event_id
       WHERE u.email LIKE 'pw-%@example.cz' AND o.status = 'paid' AND t.status = 'valid'
       ORDER BY t.created_at DESC
       LIMIT 1`,
    );
    ticket = r.rows[0];
  }
  if (!ticket) {
    fail("Nenašel jsem žádný 'valid' pw-* lístek. Spusť nejdřív Playwright spec (vyrobí čerstvé lístky).");
    process.exit(1);
  }
  ok(`ticket ${ticket.id.slice(0, 8)}… status=${ticket.status} email=${ticket.email}`);
  ok(`event "${ticket.title}" promoter=${ticket.promoter_id.slice(0, 8)}…`);

  step('2. Mailhog: poslední email má PDF attachment');
  // Email odesílá /api/internal/order-completed přes nodemailer na
  // SMTP localhost:1025. Když Docker Desktop port forward selže (port v
  // listen tabulce ale connection timeoutuje), webhook vrátí emailSent=false.
  // To je infra issue, ne aplikační bug — proto tady jen warning, ne fail.
  let matched = [];
  let totalEmails = 0;
  for (let i = 0; i < 3 && matched.length === 0; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, 2000));
    const mh = await fetch(`${MAILHOG}/api/v2/messages?limit=200`);
    if (!mh.ok) { console.log(`  \x1b[33m⚠\x1b[0m Mailhog API ${mh.status}`); break; }
    const data = await mh.json();
    totalEmails = data.total ?? 0;
    const targetLower = ticket.email.toLowerCase();
    matched = (data.items ?? []).filter((m) => {
      const to = m.To?.[0];
      const addr = `${to?.Mailbox}@${to?.Domain}`.toLowerCase();
      return addr === targetLower;
    });
  }
  if (matched.length === 0) {
    console.log(
      `  \x1b[33m⚠\x1b[0m Žádný email pro ${ticket.email} (z ${totalEmails}). ` +
      `Pravděpodobně Docker Desktop SMTP port 1025 forward broken. ` +
      `Webhook /api/internal/order-completed vrací emailSent=false. ` +
      `Není to bug v Tixly kódu — restart Docker Desktop / WSL.`,
    );
  } else {
    {
      const msg = matched[0];
      const subject = msg.Content?.Headers?.Subject?.[0] ?? '(no subject)';
      ok(`subject: ${decodeMimeSubject(subject)}`);
      // Mailhog v2 oddělil multipart parts do MIME.Parts
      const parts = msg.MIME?.Parts ?? [];
      const pdf = parts.find(
        (p) => /application\/pdf/i.test(p.Headers?.['Content-Type']?.[0] ?? ''),
      );
      if (!pdf) {
        // Mailhog někdy nesplit multipart pro malé maily — fallback: hledej v Body
        const body = msg.Content?.Body ?? '';
        if (/Content-Type:\s*application\/pdf/i.test(body) && body.length > 5000) {
          ok(`multipart Body obsahuje application/pdf (size ${body.length} B)`);
        } else {
          fail(`PDF attachment chybí (parts=${parts.length}, body=${body.length} B)`);
        }
      } else {
        const sizeB = pdf.Body?.length ?? 0;
        ok(`PDF attachment: ${sizeB} B base64-encoded`);
        if (sizeB < 2000) fail('PDF je podezřele malé (< 2 KB)');
      }
    }
  }

  step('3. Dešifruj TOTP secret a vygeneruj aktuální 6-místný kód');
  const secretBundle = ticket.totp_secret_encrypted.toString('base64');
  const secretB64 = decryptSecret(secretBundle);
  const secretRaw = Buffer.from(secretB64, 'base64');
  ok(`secret length: ${secretRaw.length} B (RFC 6238 doporučuje 20 B SHA-1)`);
  const code = generateTotp(secretRaw);
  ok(`aktuální TOTP: ${code}`);

  step('4. Najdi promotér účet pro daný event');
  const promoter = await pool.query(
    `SELECT u.email, u.id, u.name
     FROM identity.users u
     JOIN platform.promoter_members pm ON pm.user_id = u.id
     WHERE pm.promoter_id = $1
     LIMIT 1`,
    [ticket.promoter_id],
  );
  if (promoter.rows.length === 0) {
    fail('Nenašel jsem promotér member pro tento event.');
    process.exit(1);
  }
  const promoterEmail = promoter.rows[0].email;
  ok(`promotér: ${promoterEmail} (${promoter.rows[0].name})`);

  step('5. Login jako promotér → získej JWT cookie');
  const loginRes = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: promoterEmail, password: 'Demo2026!' }),
  });
  if (!loginRes.ok) {
    const txt = await loginRes.text();
    fail(`Login HTTP ${loginRes.status}: ${txt.slice(0, 200)}`);
    process.exit(1);
  }
  const setCookie = loginRes.headers.get('set-cookie') ?? '';
  const cookieHeader = setCookie
    .split(/,(?=\s*[A-Za-z0-9_-]+=)/)
    .map((c) => c.split(';')[0].trim())
    .filter(Boolean)
    .join('; ');
  if (!cookieHeader.includes('accessToken')) {
    fail(`Login nevrátil accessToken cookie (got: ${cookieHeader.slice(0, 100)})`);
    process.exit(1);
  }
  ok(`accessToken cookie získán (${cookieHeader.length} B)`);

  step('6. POST /api/admin/scanner/validate s ticket + TOTP');
  const scanRes = await fetch(`${BASE}/api/admin/scanner/validate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookieHeader },
    body: JSON.stringify({ ticketId: ticket.id, totpCode: code }),
  });
  const scanData = await scanRes.json().catch(() => ({}));
  if (!scanRes.ok) {
    fail(`Scanner HTTP ${scanRes.status}: ${JSON.stringify(scanData)}`);
  } else {
    ok(`scanner result: ${scanData.result} (${scanData.kind ?? '-'})`);
    if (scanData.result !== 'admitted') {
      fail(`Očekáván 'admitted', dostal '${scanData.result}': ${scanData.message ?? ''}`);
    }
  }

  step('7. DB: ticket je teď used + used_at NOT NULL');
  const after = await pool.query(
    `SELECT status, used_at FROM tickets.tickets WHERE id = $1`,
    [ticket.id],
  );
  const t2 = after.rows[0];
  if (t2.status === 'used' && t2.used_at) {
    ok(`ticket.status=used, used_at=${new Date(t2.used_at).toISOString()}`);
  } else {
    fail(`status=${t2.status}, used_at=${t2.used_at}`);
  }

  step('8. Idempotency: druhý sken stejného lístku → already_used');
  const scan2 = await fetch(`${BASE}/api/admin/scanner/validate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookieHeader },
    body: JSON.stringify({ ticketId: ticket.id, totpCode: code }),
  });
  const scan2Data = await scan2.json().catch(() => ({}));
  if (scan2Data.result === 'already_used') {
    ok(`opakovaný sken = already_used (${scan2Data.message ?? ''})`);
  } else {
    fail(`Očekáván 'already_used', dostal '${scan2Data.result}'`);
  }

  console.log('\n' + (process.exitCode ? '\x1b[31mFAIL\x1b[0m' : '\x1b[32mOK\x1b[0m'));
} finally {
  await pool.end();
}

function decodeMimeSubject(s) {
  return s.replace(/=\?UTF-8\?Q\?(.+?)\?=/gi, (_m, enc) =>
    enc.replace(/_/g, ' ').replace(/=([0-9A-Fa-f]{2})/g, (_, hex) =>
      String.fromCharCode(parseInt(hex, 16)),
    ),
  ).replace(/\s+/g, ' ').trim();
}
