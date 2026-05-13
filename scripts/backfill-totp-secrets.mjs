// =============================================================================
// Tixly: backfill placeholder TOTP secrets pro seedované tickety
//
// Důvod: seed-rich-demo-phase4-orders.sql ukládá totp_secret_encrypted jako
// 32B samých nul (placeholder). Pro funkční dynamický barcode E2E potřebujeme
// pravý zašifrovaný TOTP secret. Tento skript najde všechny placeholdery
// a nahradí je novými AES-GCM bundly podle ENCRYPTION_KEY z .env.local.
//
// Spuštění:  node scripts/backfill-totp-secrets.mjs
//
// Idempotent: spouští se pouze proti placeholderům (samé nuly).
// =============================================================================

import { createCipheriv, createHash, randomBytes } from 'crypto';
import { readFileSync } from 'fs';
import { createRequire } from 'module';
// `pg` je v nextjs-boilerplate/node_modules — resolve odtamtud
const require = createRequire(
  new URL('../nextjs-boilerplate/package.json', import.meta.url),
);
const { Pool } = require('pg');

// Načti env z nextjs-boilerplate/.env.local
const envFile = readFileSync(
  new URL('../nextjs-boilerplate/.env.local', import.meta.url),
  'utf8',
);
const env = Object.fromEntries(
  envFile
    .split('\n')
    .filter((l) => l.trim() && !l.trim().startsWith('#'))
    .map((l) => {
      const eq = l.indexOf('=');
      return [l.slice(0, eq).trim(), l.slice(eq + 1).trim()];
    }),
);

const DATABASE_URL = env.DATABASE_URL ?? process.env.DATABASE_URL;
const ENCRYPTION_KEY = env.ENCRYPTION_KEY ?? process.env.ENCRYPTION_KEY;
if (!DATABASE_URL || !ENCRYPTION_KEY) {
  console.error('DATABASE_URL nebo ENCRYPTION_KEY chybí.');
  process.exit(1);
}

function getKey() {
  if (ENCRYPTION_KEY.length === 64) return Buffer.from(ENCRYPTION_KEY, 'hex');
  return createHash('sha256').update(ENCRYPTION_KEY).digest();
}

function encryptSecret(plaintext) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, ciphertext, tag]);
}

const pool = new Pool({ connectionString: DATABASE_URL });

const r = await pool.query(
  `SELECT id, totp_secret_encrypted FROM tickets.tickets`,
);

let placeholders = 0;
let updated = 0;
for (const row of r.rows) {
  const buf = row.totp_secret_encrypted;
  // Placeholder = celý buffer nuly
  if (!buf || buf.length === 0 || buf.every((b) => b === 0)) {
    placeholders++;
    const totpSecretRaw = randomBytes(20); // RFC 6238 doporučuje 160-bit
    const bundle = encryptSecret(totpSecretRaw.toString('base64'));
    await pool.query(
      `UPDATE tickets.tickets SET totp_secret_encrypted = $2 WHERE id = $1`,
      [row.id, bundle],
    );
    updated++;
  }
}

console.log(`Total tickets: ${r.rows.length}`);
console.log(`Placeholders found: ${placeholders}`);
console.log(`Updated: ${updated}`);

await pool.end();
