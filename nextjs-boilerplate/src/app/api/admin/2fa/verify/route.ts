/**
 * POST /api/admin/2fa/verify — verify TOTP code, mark 2FA as enabled.
 * Body: { code: '123456' }
 *
 * Po prvním úspěšném verify vygeneruje 10× backup codes (one-time recovery).
 */

import { createHash, randomBytes } from 'crypto';
import { db } from '@/lib/db/rls-pool';
import { runAsUser } from '@/lib/auth';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { decryptSecret } from '@/lib/crypto';
import { verifyTotpCode } from '@/lib/totp/verify';


const schema = z.object({
  code: z.string().regex(/^\d{6}$/),
});

function generateBackupCode(): string {
  return randomBytes(4).toString('hex').toUpperCase().match(/.{1,4}/g)!.join('-');
}

function hashCode(code: string): string {
  return createHash('sha256').update(code.replace(/-/g, '').toUpperCase()).digest('hex');
}

export async function POST(req: NextRequest): Promise<Response> {
  return runAsUser(req, async (userId) => {
  const body: unknown = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed' }, { status: 422 });
  }

  const r = await db().query<{
    totp_secret_encrypted: Buffer;
    enabled: boolean;
    backup_codes_hash: string[];
  }>(
    `SELECT totp_secret_encrypted, enabled, backup_codes_hash
     FROM identity.user_2fa WHERE user_id = $1`,
    [userId],
  );
  if (r.rows.length === 0) {
    return NextResponse.json({ error: 'NOT_ENROLLED' }, { status: 404 });
  }

  const secretB64 = decryptSecret(r.rows[0].totp_secret_encrypted.toString('base64'));
  const secretRaw = Buffer.from(secretB64, 'base64');
  const valid = verifyTotpCode(parsed.data.code, secretRaw, { window: 1 });
  if (!valid) {
    return NextResponse.json({ error: 'INVALID_CODE' }, { status: 401 });
  }

  // First-time enrollment? Generate backup codes
  let backupCodes: string[] | null = null;
  if (!r.rows[0].enabled) {
    backupCodes = Array.from({ length: 10 }, generateBackupCode);
    const hashes = backupCodes.map(hashCode);
    await db().query(
      `UPDATE identity.user_2fa
       SET enabled = true, enrolled_at = NOW(), backup_codes_hash = $2,
           last_used_at = NOW()
       WHERE user_id = $1`,
      [userId, hashes],
    );
  } else {
    await db().query(
      `UPDATE identity.user_2fa SET last_used_at = NOW() WHERE user_id = $1`,
      [userId],
    );
  }

  return NextResponse.json({
    ok: true,
    enabled: true,
    backupCodes, // jen poprvé!
  });

  });
}
