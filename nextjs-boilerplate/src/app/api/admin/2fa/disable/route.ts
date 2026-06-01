/**
 * POST /api/admin/2fa/disable
 * Body: { code: 6-digit TOTP } — vyžaduje aktuální 2FA verification pro disable.
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsUser } from '@/lib/auth';
import { z } from 'zod';
import { decryptSecret } from '@/lib/crypto';
import { verifyTotpCode } from '@/lib/totp/verify';


const schema = z.object({
  code: z.string().regex(/^\d{6}$/),
});

export async function POST(req: NextRequest): Promise<Response> {
  return runAsUser(req, async (userId) => {
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

  });
}
