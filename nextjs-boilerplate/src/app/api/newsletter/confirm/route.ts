/**
 * GET /api/newsletter/confirm?token=XXX
 *
 * Confirm double opt-in. Po confirm → redirect na /cs/newsletter/confirmed.
 */

import { NextRequest, NextResponse } from 'next/server';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';


export async function GET(req: NextRequest): Promise<Response> {
  return runWithServiceContext(async () => {

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

  });
}
