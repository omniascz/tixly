// POST /api/cron/loyalty-recompute-tiers — denní downgrade tierů.
// Chráněno CRON_SECRET.

import { NextRequest, NextResponse } from 'next/server';
import { recomputeTiers } from '../../../../services/loyalty-tier-cashback.service.js';
import { getDb } from '../../../../lib/db.js';
import { getKafka } from '../../../../lib/kafka.js';

export async function POST(request: NextRequest): Promise<NextResponse> {
  const cronSecret = process.env['CRON_SECRET'];
  if (!cronSecret) {
    return NextResponse.json(
      { error: 'CRON_SECRET není nakonfigurován.', code: 'SERVER_MISCONFIGURED' },
      { status: 500 },
    );
  }

  if (request.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json(
      { error: 'Unauthorized', code: 'UNAUTHORIZED' },
      { status: 401 },
    );
  }

  try {
    const result = await recomputeTiers({ db: getDb(), kafka: getKafka() });
    return NextResponse.json({
      ok: true,
      ...result,
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
