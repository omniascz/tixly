/**
 * GET /api/admin/campaigns/smart-send-time?channel=email
 *
 * Vrací doporučený scheduled_at pro segment kupců promotéra.
 * Algoritmus se opírá o historical opens (180 dní) — pokud nemáme data,
 * fallback na industry best practice (email: Tue 10am, SMS: Fri 5pm).
 */

import { NextRequest, NextResponse } from 'next/server';
import { requirePromoter } from '@/lib/admin-auth';
import { predictSegmentSendTime } from '@/lib/ai/smart-send-time';

const ALLOWED_CHANNELS = new Set(['email', 'sms', 'push', 'inapp']);

export async function GET(req: NextRequest): Promise<Response> {
  const promoter = await requirePromoter(req);
  if (!promoter) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const channel = req.nextUrl.searchParams.get('channel') ?? 'email';
  if (!ALLOWED_CHANNELS.has(channel)) {
    return NextResponse.json({ error: 'Invalid channel' }, { status: 422 });
  }

  const result = await predictSegmentSendTime({
    promoterId: promoter.promoterId,
    channel: channel as 'email' | 'sms' | 'push' | 'inapp',
  });

  return NextResponse.json(result);
}
