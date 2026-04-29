/**
 * GET  /api/promoters/:promoterId/events/:eventId/pricing/rule?ticketTypeId=...
 * PUT  /api/promoters/:promoterId/events/:eventId/pricing/rule
 *
 * Správa pravidel dynamického cenotvorby.
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  getRule,
  setRule,
  ServiceDeps,
} from '../../../../../../../../services/dynamic-pricing.service.js';
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
    const rule = await getRule(params.eventId, ticketTypeId, params.promoterId, deps);
    return NextResponse.json({ rule });
  } catch (err) {
    console.error('[GET pricing/rule] Chyba:', err);
    return NextResponse.json({ error: 'Interní chyba serveru' }, { status: 500 });
  }
}

export async function PUT(
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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Neplatný JSON.' }, { status: 400 });
  }

  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json(
      { error: 'Tělo požadavku musí být JSON objekt.' },
      { status: 400 },
    );
  }

  const { ticketTypeId, ...rulePartial } = body as Record<string, unknown>;

  if (typeof ticketTypeId !== 'string' || !ticketTypeId.trim()) {
    return NextResponse.json(
      { error: 'ticketTypeId je povinný a musí být neprázdný řetězec.' },
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
    const rule = await setRule(
      params.eventId,
      ticketTypeId as string,
      params.promoterId,
      rulePartial as Record<string, unknown>,
      deps,
    );
    return NextResponse.json({ rule });
  } catch (err) {
    console.error('[PUT pricing/rule] Chyba:', err);
    return NextResponse.json({ error: 'Interní chyba serveru' }, { status: 500 });
  }
}
