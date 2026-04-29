/**
 * GET /api/newsletter/confirm?token=XXX
 *
 * Confirm double opt-in. Po confirm → redirect na /cs/newsletter/confirmed.
 */

import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

export async function GET(req: NextRequest): Promise<Response> {
  const token = req.nextUrl.searchParams.get('token');
  if (!token) {
    return NextResponse.redirect(new URL('/cs/newsletter/confirmed?error=missing-token', req.url));
  }
  const r = await db().query(
    `UPDATE marketing.newsletter_subscribers
     SET status = 'confirmed', confirmed_at = NOW()
     WHERE confirm_token = $1 AND status = 'pending'
     RETURNING id`,
    [token],
  );
  if (r.rowCount === 0) {
    return NextResponse.redirect(new URL('/cs/newsletter/confirmed?error=invalid-token', req.url));
  }
  return NextResponse.redirect(new URL('/cs/newsletter/confirmed?status=ok', req.url));
}
