/**
 * POST /api/admin/2fa/disable
 * Body: { code: 6-digit TOTP } — vyžaduje aktuální 2FA verification pro disable.
 */

import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { z } from 'zod';
import { decryptSecret } from '@/lib/crypto';
import { verifyTotpCode } from '@/lib/totp/verify';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

const schema = z.object({
  code: z.string().regex(/^\d{6}$/),
});

export async function POST(req: NextRequest): Promise<Response> {
  const userId = req.headers.get('x-user-id');
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body: unknown = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Validation failed' }, { status: 422 });

  const r = await db().query<{ totp_secret_encrypted: Buffer; enabled: boolean }>(
    `SELECT totp_secret_encrypted, enabled FROM identity.user_2fa WHERE user_id = $1`,
    [userId],
  );
  if (r.rows.length === 0 || !r.rows[0].enabled) {
    return NextResponse.json({ error: 'NOT_ENABLED' }, { status: 404 });
  }
  const secretB64 = decryptSecret(r.rows[0].totp_secret_encrypted.toString('base64'));
  const secretRaw = Buffer.from(secretB64, 'base64');
  const valid = verifyTotpCode(parsed.data.code, secretRaw, { window: 1 });
  if (!valid) return NextResponse.json({ error: 'INVALID_CODE' }, { status: 401 });

  await db().query(
    `UPDATE identity.user_2fa
     SET enabled = false, disabled_at = NOW(), backup_codes_hash = '{}'
     WHERE user_id = $1`,
    [userId],
  );
  return NextResponse.json({ ok: true });
}
