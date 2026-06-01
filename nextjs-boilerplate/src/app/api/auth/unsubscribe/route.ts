/**
 * GET /api/auth/unsubscribe?token=...
 *
 * One-click unsubscribe (RFC 8058) — bez nutnosti loginu.
 * Token kóduje user_id + scope (marketing | promoter_news | all).
 * Aktualizuje `identity.notification_preferences`.
 *
 * Vrátí JSON status pro UI stránku `/cs/unsubscribe`.
 */

import { NextRequest, NextResponse } from 'next/server';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';
import { verifyUnsubscribeToken } from '@/lib/email-verification/unsubscribe-token';


async function handleUnsubscribe(token: string) {
  const v = verifyUnsubscribeToken(token);
  if (!v) {
    return { status: 'invalid' as const, statusCode: 410 };
  }

  // UPSERT notification_preferences podle scope
  const updates: string[] = [];
  if (v.scope === 'marketing' || v.scope === 'all') updates.push('marketing = false');
  if (v.scope === 'promoter_news' || v.scope === 'all') updates.push('promoter_news = false');
  if (v.scope === 'all') updates.push('abandoned_cart = false');

  if (updates.length === 0) {
    return { status: 'invalid' as const, statusCode: 422 };
  }

  // INSERT defaults pokud neexistuje, jinak UPDATE
  await db().query(
    `INSERT INTO identity.notification_preferences (user_id)
     VALUES ($1)
     ON CONFLICT (user_id) DO NOTHING`,
    [v.userId],
  );
  await db().query(
    `UPDATE identity.notification_preferences
       SET ${updates.join(', ')}, updated_at = now()
     WHERE user_id = $1`,
    [v.userId],
  );

  return { status: 'unsubscribed' as const, scope: v.scope, statusCode: 200 };
}

export async function GET(req: NextRequest): Promise<Response> {
  return runWithServiceContext(async () => {

  const token = req.nextUrl.searchParams.get('token');
  if (!token) {
    return NextResponse.json({ status: 'invalid', message: 'Chybí token.' }, { status: 422 });
  }
  const result = await handleUnsubscribe(token);
  return NextResponse.json(result, { status: result.statusCode });

  });
}

// RFC 8058 list-unsubscribe header — Gmail klikne POST automaticky
export async function POST(req: NextRequest): Promise<Response> {
  return runWithServiceContext(async () => {

  const token = req.nextUrl.searchParams.get('token');
  if (!token) return NextResponse.json({ error: 'no token' }, { status: 422 });
  const result = await handleUnsubscribe(token);
  return NextResponse.json(result, { status: result.statusCode });

  });
}
