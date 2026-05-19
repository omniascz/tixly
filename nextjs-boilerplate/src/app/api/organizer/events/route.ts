/**
 * Organizer B2B API — vytvoření akce z 3rd-party systému.
 *
 * GET /api/organizer/events — list (auth required, returns 401 bez tokenu)
 * POST /api/organizer/events — create event (auth + events:write scope)
 *
 * Pro M1 launch: minimal viable. Plný feature set (venue auto-create, batch,
 * cancel/refund flow) přijde ve Faze 13 — viz docs/FINAL-WORK-MAP.md.
 */
import { NextRequest, NextResponse } from 'next/server';
import { b2bResponseHeaders, verifyB2bToken } from '@/lib/b2b-auth';

export async function GET(req: NextRequest): Promise<Response> {
  const ctx = await verifyB2bToken(req);
  if (!ctx) {
    return NextResponse.json(
      { error: 'UNAUTHORIZED' },
      { status: 401, headers: b2bResponseHeaders() },
    );
  }
  // Stub: vrátí prázdné pole — full impl ve Faze 13
  return NextResponse.json(
    { events: [], note: 'Organizer API list endpoint — see /api/v1/events for read-only feed' },
    { status: 200, headers: b2bResponseHeaders(ctx) },
  );
}

export async function POST(req: NextRequest): Promise<Response> {
  const ctx = await verifyB2bToken(req);
  if (!ctx) {
    return NextResponse.json(
      { error: 'UNAUTHORIZED' },
      { status: 401, headers: b2bResponseHeaders() },
    );
  }
  if (!ctx.scope.includes('events:write') && !ctx.scope.includes('*')) {
    return NextResponse.json(
      { error: 'INSUFFICIENT_SCOPE', message: 'events:write scope required' },
      { status: 403, headers: b2bResponseHeaders(ctx) },
    );
  }
  // Stub: 501 dokud nebude full implementace
  return NextResponse.json(
    {
      error: 'NOT_IMPLEMENTED',
      message: 'Organizer create endpoint je M2 milestone. Použij /admin/events/new přes web UI.',
    },
    { status: 501, headers: b2bResponseHeaders(ctx) },
  );
}

export async function OPTIONS(): Promise<Response> {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    },
  });
}
