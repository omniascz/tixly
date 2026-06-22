/**
 * POST /api/internal/cron/forgemsg-dispatch
 *
 * Drains the ForgeMsg outbox to ForgeMsg's ticketing ingest API. Idempotent,
 * retrying; safe to run frequently. Auth: x-internal-token.
 */
import { timingSafeEqual } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { runWithServiceContext } from '@/lib/db/rls-pool';
import { dispatchOutbox } from '@/lib/forgemsg/dispatch';

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export async function POST(req: NextRequest): Promise<Response> {
  return runWithServiceContext(async () => {
    const token = req.headers.get('x-internal-token') ?? '';
    const expected = process.env.INTERNAL_SERVICE_TOKEN ?? '';
    if (!expected || !safeEqual(token, expected)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const result = await dispatchOutbox();
    return NextResponse.json(result);
  });
}
