/**
 * GET /api/v1/events — B2B API: seznam akcí promotéra.
 *
 * Auth: `Authorization: Bearer tick_(test|live)_<hex>` (b2b.api_keys lookup).
 * Scope požadovaný: `events:read`
 *
 * Response: { events: Array<{ id, title, slug, dateStart, status }> }
 * Headers: X-RateLimit-{Limit,Remaining,Reset} + CORS
 */
import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { b2bResponseHeaders, verifyB2bToken } from '@/lib/b2b-auth';
import { checkRateLimit } from '@/lib/rate-limit/per-tenant';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

export async function GET(req: NextRequest): Promise<Response> {
  const ctx = await verifyB2bToken(req);
  if (!ctx) {
    return NextResponse.json(
      { error: 'UNAUTHORIZED', message: 'Valid Bearer token required (tick_test_* or tick_live_*)' },
      { status: 401, headers: b2bResponseHeaders() },
    );
  }
  if (!ctx.scope.includes('events:read') && !ctx.scope.includes('*')) {
    return NextResponse.json(
      { error: 'INSUFFICIENT_SCOPE', message: 'Token does not have events:read scope' },
      { status: 403, headers: b2bResponseHeaders(ctx) },
    );
  }

  // Per-tenant rate limit: 1000 req/min per API key
  const rl = checkRateLimit(`b2b:${ctx.keyId}:events-read`, {
    limit: 1000,
    windowMs: 60_000,
  });
  if (!rl.ok) {
    return NextResponse.json(
      { error: 'RATE_LIMITED', retryAfterMs: rl.retryAfterMs },
      {
        status: 429,
        headers: {
          ...b2bResponseHeaders(ctx),
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': String(Math.floor(rl.resetAt / 1000)),
          'Retry-After': String(Math.ceil((rl.retryAfterMs ?? 60_000) / 1000)),
        },
      },
    );
  }

  const r = await db().query<{
    id: string;
    title: string;
    slug: string | null;
    date_start: string;
    status: string;
  }>(
    `SELECT id, title, slug, date_start::text, status
       FROM catalog.events
      WHERE promoter_id = $1 AND status = 'published'
      ORDER BY date_start DESC
      LIMIT 100`,
    [ctx.promoterId],
  );

  return NextResponse.json(
    {
      events: r.rows.map((e) => ({
        id: e.id,
        title: e.title,
        slug: e.slug,
        dateStart: e.date_start,
        status: e.status,
      })),
    },
    {
      status: 200,
      headers: {
        ...b2bResponseHeaders(ctx),
        'X-RateLimit-Remaining': String(rl.remaining),
        'X-RateLimit-Reset': String(Math.floor(rl.resetAt / 1000)),
      },
    },
  );
}

export async function OPTIONS(): Promise<Response> {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Max-Age': '86400',
    },
  });
}
