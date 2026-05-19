/**
 * POST /api/admin/2fa/setup — generate new TOTP secret + return otpauth URL + QR-friendly hex
 * GET  /api/admin/2fa/setup — current 2FA status
 */

import { randomBytes } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { encryptSecret } from '@/lib/crypto';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

function base32Encode(buf: Buffer): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += alphabet[(value >>> bits) & 0x1f];
    }
  }
  if (bits > 0) out += alphabet[(value << (5 - bits)) & 0x1f];
  return out;
}

export async function GET(req: NextRequest): Promise<Response> {
  const userId = req.headers.get('x-user-id');
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const r = await db().query<{ enabled: boolean; enrolled_at: string | null }>(
    `SELECT enabled, enrolled_at FROM identity.user_2fa WHERE user_id = $1`,
    [userId],
  );
  if (r.rows.length === 0) {
    return NextResponse.json({ enrolled: false, enabled: false });
  }
  return NextResponse.json({
    enrolled: true,
    enabled: r.rows[0].enabled,
    enrolledAt: r.rows[0].enrolled_at,
  });
}

export async function POST(req: NextRequest): Promise<Response> {
  const userId = req.headers.get('x-user-id');
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Get user email for issuer
  const userRes = await db().query<{ email: string }>(
    `SELECT email FROM identity.users WHERE id = $1`,
    [userId],
  );
  if (userRes.rows.length === 0) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const email = userRes.rows[0].email;

  // Generate 20-byte secret
  const secretRaw = randomBytes(20);
  const secretBase32 = base32Encode(secretRaw);
  const encryptedBundle = Buffer.from(encryptSecret(secretRaw.toString('base64')), 'base64');

  // Save (replace existing if not yet enabled)
  await db().query(
    `INSERT INTO identity.user_2fa (user_id, totp_secret_encrypted, enabled)
     VALUES ($1, $2, false)
     ON CONFLICT (user_id) DO UPDATE SET
       totp_secret_encrypted = CASE WHEN identity.user_2fa.enabled THEN identity.user_2fa.totp_secret_encrypted ELSE EXCLUDED.totp_secret_encrypted END`,
    [userId, encryptedBundle],
  );

  const issuer = 'Tixly';
  const otpauth = `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(email)}?secret=${secretBase32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;

  return NextResponse.json({
    otpauth,
    secretBase32,
    qrAlt: `Tixly: ${email}`,
  });
}
