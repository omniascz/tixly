import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  verifyPassword,
  signAccessToken,
  signRefreshToken,
  setAuthCookies,
  getUserRoles,
} from '@/lib/auth';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit/per-tenant';
import { clientIp } from '@/lib/security/client-ip';

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  totpCode: z.string().regex(/^\d{6}$/).optional(),
  backupCode: z.string().min(8).max(15).optional(),
});

interface UserRow {
  id: string;
  email: string;
  name: string;
  password_hash: string;
}

export async function POST(request: NextRequest): Promise<Response> {
  // Login běží před vznikem user kontextu (čte identity.users/user_2fa) → service.
  return runWithServiceContext(async () => {
  const body: unknown = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed' }, { status: 422 });
  }
  const { email, password, totpCode, backupCode } = parsed.data;

  // Brute-force ochrana ve DVOU rovinách (globální přes Redis/Upstash, in-memory
  // fallback): per IP (10 / 5 min) proti plošnému hádání a per ÚČET (10 / 15 min)
  // proti cílenému hádání hesla z mnoha IP. IP se bere z důvěryhodného req.ip
  // (Vercel), ne z klientem ovladatelného x-forwarded-for levého prvku.
  const ip = clientIp(request);
  const rlIp = await checkRateLimit(`login:${ip}`, { limit: 10, windowMs: 5 * 60_000 });
  const limitedIp = rateLimitResponse(rlIp, 'login');
  if (limitedIp) return limitedIp;

  const rlAcct = await checkRateLimit(`login-acct:${email.toLowerCase()}`, {
    limit: 10,
    windowMs: 15 * 60_000,
  });
  const limitedAcct = rateLimitResponse(rlAcct, 'login');
  if (limitedAcct) return limitedAcct;

  // password_hash žije v identity.user_secrets (RLS split) — login je service kontext.
  const result = await db().query<UserRow>(
    `SELECT u.id, u.email, u.name, s.password_hash
       FROM identity.users u
       JOIN identity.user_secrets s ON s.user_id = u.id
      WHERE u.email = $1 LIMIT 1`,
    [email.toLowerCase()],
  );
  if (result.rows.length === 0) {
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
  }
  const row = result.rows[0];
  if (!(await verifyPassword(password, row.password_hash))) {
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
  }

  // 2FA check
  const twofa = await db().query<{
    totp_secret_encrypted: Buffer;
    enabled: boolean;
    backup_codes_hash: string[];
  }>(
    `SELECT totp_secret_encrypted, enabled, backup_codes_hash
     FROM identity.user_2fa WHERE user_id = $1 AND enabled = true`,
    [row.id],
  );
  if (twofa.rows.length > 0) {
    if (!totpCode && !backupCode) {
      return NextResponse.json(
        { error: 'TOTP_REQUIRED', requires2fa: true },
        { status: 401 },
      );
    }
    let valid = false;
    if (totpCode) {
      const { decryptSecret } = await import('@/lib/crypto');
      const { verifyTotpCode } = await import('@/lib/totp/verify');
      const secretB64 = decryptSecret(twofa.rows[0].totp_secret_encrypted.toString('base64'));
      const secretRaw = Buffer.from(secretB64, 'base64');
      valid = verifyTotpCode(totpCode, secretRaw, { window: 1 });
    } else if (backupCode) {
      const { createHash } = await import('crypto');
      const hash = createHash('sha256').update(backupCode.replace(/-/g, '').toUpperCase()).digest('hex');
      const codes = twofa.rows[0].backup_codes_hash;
      if (codes.includes(hash)) {
        valid = true;
        // Consume backup code
        const remaining = codes.filter((c) => c !== hash);
        await db().query(
          `UPDATE identity.user_2fa SET backup_codes_hash = $2 WHERE user_id = $1`,
          [row.id, remaining],
        );
      }
    }
    if (!valid) {
      return NextResponse.json(
        { error: 'TOTP_INVALID', requires2fa: true },
        { status: 401 },
      );
    }
    await db().query(
      `UPDATE identity.user_2fa SET last_used_at = NOW() WHERE user_id = $1`,
      [row.id],
    );
  }

  const user = { id: row.id, email: row.email, name: row.name };
  const roles = await getUserRoles(row.id);
  const accessToken = await signAccessToken(user, roles);
  const refreshToken = await signRefreshToken(user);

  const res = NextResponse.json({ user, roles, accessToken });
  setAuthCookies(res, accessToken, refreshToken);
  return res;
  });
}
