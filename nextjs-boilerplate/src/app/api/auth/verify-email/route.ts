/**
 * GET /api/auth/verify-email?token=...
 *
 * Validuje HMAC token a nastaví `users.email_verified_at = now()`.
 * Vrátí JSON s success/expired/invalid status.
 * UI komponenta `/cs/verify-email` přečte query token a zavolá tento endpoint.
 */

import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { verifyEmailToken } from '@/lib/email-verification/token';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

export async function GET(req: NextRequest): Promise<Response> {
  const token = req.nextUrl.searchParams.get('token');
  if (!token) {
    return NextResponse.json({ status: 'invalid', message: 'Chybí token.' }, { status: 422 });
  }
  const v = verifyEmailToken(token);
  if (!v) {
    return NextResponse.json(
      { status: 'invalid_or_expired', message: 'Token je neplatný nebo vypršel.' },
      { status: 410 },
    );
  }

  // Idempotent: pokud už je ověřený, vrátí success
  const r = await db().query<{ email_verified_at: string | null; email: string }>(
    `UPDATE identity.users
       SET email_verified_at = COALESCE(email_verified_at, now()),
           updated_at = now()
     WHERE id = $1 AND deleted_at IS NULL
     RETURNING email_verified_at, email`,
    [v.userId],
  );
  if (r.rows.length === 0) {
    return NextResponse.json({ status: 'user_not_found' }, { status: 404 });
  }
  return NextResponse.json({
    status: 'verified',
    email: r.rows[0].email,
    verifiedAt: r.rows[0].email_verified_at,
  });
}
