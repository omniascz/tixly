/**
 * GET /api/platform/admin/invoices — platform admin invoices endpoint.
 *
 * Vyžaduje platform admin JWT. Stub pro M1 launch — full impl ve Faze 4
 * (billing module existuje, frontend route čeká).
 */
import { NextRequest, NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/platform-auth';

export async function GET(req: NextRequest): Promise<Response> {
  const admin = await requirePlatformAdmin(req);
  if (!admin) {
    return NextResponse.json(
      { error: 'UNAUTHORIZED', message: 'Platform admin token required' },
      { status: 401 },
    );
  }
  return NextResponse.json({
    invoices: [],
    note: 'Faze 4 billing module endpoint stub — frontend integration M2',
  });
}
