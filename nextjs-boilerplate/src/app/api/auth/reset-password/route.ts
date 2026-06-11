/**
 * POST /api/auth/reset-password
 *
 * Body: { token: string, newPassword: string }
 *
 * Ověří token (bcrypt compare), nastaví nové heslo, marknout token jako použitý,
 * revokovat všechny existující refresh tokeny (force logout).
 *
 * Rate limit: 10/15min per IP (anti-brute-force).
 */

import bcrypt from 'bcryptjs';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit/per-tenant';
import { clientIp as getClientIp } from '@/lib/security/client-ip';


const schema = z.object({
  token: z.string().min(32).max(256),
  newPassword: z.string().min(8).max(200),
});

const BCRYPT_COST = 12; // pro password hash, vyšší než token hash

export async function POST(req: NextRequest): Promise<Response> {
  return runWithServiceContext(async () => {

  const ip = getClientIp(req);
  const rl = await checkRateLimit(`reset-password:${ip}`, { limit: 10, windowMs: 15 * 60 * 1000 });
  const rlResp = rateLimitResponse(rl, 'reset-password');
  if (rlResp) return rlResp;

  const body: unknown = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'BAD_INPUT' }, { status: 422 });
  }
  const { token, newPassword } = parsed.data;

  // Password strength check (basic)
  if (
    newPassword.length < 8 ||
    !/[a-z]/.test(newPassword) ||
    !/[A-Z0-9]/.test(newPassword)
  ) {
    return NextResponse.json(
      {
        error: 'WEAK_PASSWORD',
        message: 'Heslo musí mít min. 8 znaků, malé i velké písmeno nebo číslici.',
      },
      { status: 422 },
    );
  }

  // Lookup non-expired non-used tokens (může být víc pro 1 usera)
  // Bcrypt compare není SARGable, takže musíme projít všechny aktivní tokens
  const candidates = await db().query<{
    id: string;
    user_id: string;
    token_hash: string;
  }>(
    `SELECT id, user_id, token_hash
     FROM identity.password_reset_tokens
     WHERE used_at IS NULL AND expires_at > NOW()
     ORDER BY created_at DESC
     LIMIT 200`,
  );

  let matchedTokenId: string | null = null;
  let matchedUserId: string | null = null;

  for (const row of candidates.rows) {
    const ok = await bcrypt.compare(token, row.token_hash);
    if (ok) {
      matchedTokenId = row.id;
      matchedUserId = row.user_id;
      break;
    }
  }

  if (!matchedTokenId || !matchedUserId) {
    return NextResponse.json(
      { error: 'INVALID_OR_EXPIRED_TOKEN' },
      { status: 401 },
    );
  }

  // Hash nového hesla
  const newHash = await bcrypt.hash(newPassword, BCRYPT_COST);

  const client = await db().connect();
  try {
    await client.query('BEGIN');

    // Update password
    await client.query(
      `UPDATE identity.users
       SET password_hash = $2, updated_at = NOW()
       WHERE id = $1`,
      [matchedUserId, newHash],
    );

    // Mark token used
    await client.query(
      `UPDATE identity.password_reset_tokens
       SET used_at = NOW()
       WHERE id = $1`,
      [matchedTokenId],
    );

    // Force logout — revoke všechny existující refresh tokens
    await client.query(
      `DELETE FROM identity.refresh_tokens WHERE user_id = $1`,
      [matchedUserId],
    ).catch(() => {
      // Tabulka může mít jiný název v této instalaci, ignore
    });

    // Audit
    await client.query(
      `INSERT INTO audit.audit_log
         (schema_name, table_name, record_id, action, actor_id, actor_type, new_values)
       VALUES ('identity', 'users', $1, 'UPDATE', $1, 'self', $2::jsonb)`,
      [matchedUserId, JSON.stringify({ event: 'password_reset', ip })],
    );

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[reset-password] update failed:', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  } finally {
    client.release();
  }

  return NextResponse.json({ ok: true });

  });
}
