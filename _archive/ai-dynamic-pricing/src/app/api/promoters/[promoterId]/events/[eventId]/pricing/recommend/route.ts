/**
 * GET /api/promoters/:promoterId/events/:eventId/pricing/recommend?ticketTypeId=...
 * Vrátí doporučenou cenu pro daný typ vstupenky.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getRecommendation, ServiceDeps } from '../../../../../../../../services/dynamic-pricing.service.js';
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

export async function GET(
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

  const url = new URL(request.url);
  const ticketTypeId = url.searchParams.get('ticketTypeId');
  if (!ticketTypeId) {
    return NextResponse.json(
      { error: 'Parametr ticketTypeId je povinný.' },
      { status: 400 },
    );
  }

  let deps: ServiceDeps;
  try {
    deps = getDeps();
  } catch {
    return NextResponse.json({ error: 'Interní chyba serveru' }, { status: 500 });
  }

  try {
    const recommendation = await getRecommendation(
      params.eventId,
      ticketTypeId,
      params.promoterId,
      deps,
    );
    return NextResponse.json({ recommendation });
  } catch (err) {
    console.error('[GET pricing/recommend] Chyba:', err);
    return NextResponse.json({ error: 'Interní chyba serveru' }, { status: 500 });
  }
}
