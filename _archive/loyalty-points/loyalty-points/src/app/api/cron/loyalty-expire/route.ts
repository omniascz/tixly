// POST /api/cron/loyalty-expire — cron job pro expiraci věrnostních bodů.
//
// Zabezpečeno pomocí CRON_SECRET v hlavičce Authorization.
// Spouštět jednou denně (např. v 02:00 UTC).

import { NextRequest, NextResponse } from 'next/server';
import { expireOldPoints } from '../../../../services/loyalty.service';
import { getDb } from '../../../../lib/db';
import { getKafka } from '../../../../lib/kafka';

// ---------------------------------------------------------------------------
// POST /api/cron/loyalty-expire
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest): Promise<NextResponse> {
  // Ověření CRON_SECRET
  const cronSecret = process.env['CRON_SECRET'];
  if (!cronSecret) {
    return NextResponse.json(
      { error: 'CRON_SECRET není nakonfigurován.', code: 'SERVER_MISCONFIGURED' },
      { status: 500 },
    );
  }

  const authHeader = request.headers.get('authorization');
  const expectedBearer = `Bearer ${cronSecret}`;

  if (authHeader !== expectedBearer) {
    return NextResponse.json(
      { error: 'Unauthorized', code: 'UNAUTHORIZED' },
      { status: 401 },
    );
  }

  try {
    const expiredCount = await expireOldPoints({ db: getDb(), kafka: getKafka() });

    return NextResponse.json({
      ok: true,
      expiredAccounts: expiredCount,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Interní chyba serveru';
    return NextResponse.json(
      { error: message, code: 'INTERNAL_ERROR' },
      { status: 500 },
    );
  }
}
