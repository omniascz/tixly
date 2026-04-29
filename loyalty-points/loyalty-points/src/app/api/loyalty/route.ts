// GET /api/loyalty — vrátí aktuální věrnostní účet přihlášeného zákazníka.

import { NextRequest, NextResponse } from 'next/server';
import { getAccount } from '../../../services/loyalty.service';
import { getDb } from '../../../lib/db';
import { getKafka } from '../../../lib/kafka';

// ---------------------------------------------------------------------------
// GET /api/loyalty
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest): Promise<NextResponse> {
  const userId = request.headers.get('x-user-id');
  if (!userId) {
    return NextResponse.json(
      { error: 'Unauthorized', code: 'UNAUTHORIZED' },
      { status: 401 },
    );
  }

  try {
    const account = await getAccount(
      { db: getDb(), kafka: getKafka() },
      userId,
    );

    return NextResponse.json({ data: account });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Interní chyba serveru';
    return NextResponse.json(
      { error: message, code: 'INTERNAL_ERROR' },
      { status: 500 },
    );
  }
}
