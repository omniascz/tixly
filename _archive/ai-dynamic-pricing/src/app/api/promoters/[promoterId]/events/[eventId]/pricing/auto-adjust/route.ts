/**
 * POST /api/promoters/:promoterId/events/:eventId/pricing/auto-adjust
 * Automaticky upraví ceny všech typů vstupenek pro daný event.
 */

import { NextRequest, NextResponse } from 'next/server';
import { autoAdjustPrices, ServiceDeps } from '../../../../../../../../services/dynamic-pricing.service.js';
import type { DbAdapter } from '@tixly/rls-multitenancy';

function getDb(): DbAdapter {
  throw new Error(
    'getDb() musí být napojen na reálný DbAdapter před nasazením.',
  );
}

function getDeps(): ServiceDeps {
  return { db: getDb() };
}

interface RouteParams {
  params: { promoterId: string; eventId: string };
}

export async function POST(
  request: NextRequest,
  { params }: RouteParams,
): Promise<NextResponse> {
  const promoterId = request.headers.get('x-promoter-id');
  if (!promoterId || promoterId !== params.promoterId) {
    return NextResponse.json(
      { error: 'Neoprávněný přístup. Chybí nebo neodpovídá x-promoter-id.' },
      { status: 401 },
    );
  }

  let deps: ServiceDeps;
  try {
    deps = getDeps();
  } catch {
    return NextResponse.json({ error: 'Interní chyba serveru' }, { status: 500 });
  }

  try {
    const result = await autoAdjustPrices(params.eventId, params.promoterId, deps);
    return NextResponse.json(result);
  } catch (err) {
    console.error('[POST pricing/auto-adjust] Chyba:', err);
    return NextResponse.json({ error: 'Interní chyba serveru' }, { status: 500 });
  }
}
