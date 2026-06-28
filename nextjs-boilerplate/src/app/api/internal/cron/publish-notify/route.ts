/**
 * POST /api/internal/cron/publish-notify
 *
 * Delivers pending sold-notifications to external Publish API source systems.
 * Runs every 5 minutes.
 *
 * Schedule in vercel.json cron: "* /5 * * * *"
 *
 * Security: x-internal-token header required.
 */

import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { processPendingNotifications } from '@/lib/publish/sold-notify';

export const dynamic = 'force-dynamic';

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export async function POST(req: NextRequest): Promise<Response> {
  const token = req.headers.get('x-internal-token') ?? '';
  const expected = process.env.INTERNAL_SERVICE_TOKEN ?? '';
  if (!expected || !safeEqual(token, expected)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const result = await processPendingNotifications(100);
  console.info('[publish-notify] cron:', result);
  return NextResponse.json({ ok: true, ...result });
}
