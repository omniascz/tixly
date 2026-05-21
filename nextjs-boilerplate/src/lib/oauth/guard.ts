/**
 * Public REST API v3 — auth guard middleware.
 *
 * Verifies Bearer token (OAuth access_token) NEBO API key (b2b.api_keys).
 * Vrátí context nebo NextResponse error.
 *
 * Rate limiting: sliding window 1h per client/key.
 */
import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { verifyAccessToken, hasScope } from '@/lib/oauth/flow';
import { verifyB2bToken } from '@/lib/b2b-auth';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

export interface ApiContext {
  type: 'oauth' | 'api_key';
  clientPkId?: string;        // OAuth client.id
  apiKeyId?: string;          // API key.id
  userId: string | null;
  promoterId: string | null;
  scopes: string[];
}

export async function requireApiAuth(req: NextRequest, requiredScope?: string): Promise<
  { ok: true; ctx: ApiContext } | { ok: false; response: NextResponse }
> {
  const auth = req.headers.get('authorization');
  if (!auth || !auth.startsWith('Bearer ')) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'missing_auth' }, { status: 401 }),
    };
  }
  const token = auth.slice(7).trim();

  // OAuth token: tk_*
  if (token.startsWith('tk_')) {
    const ctx = await verifyAccessToken(token);
    if (!ctx) {
      return {
        ok: false,
        response: NextResponse.json({ error: 'invalid_token' }, { status: 401 }),
      };
    }
    if (requiredScope && !hasScope(ctx, requiredScope)) {
      return {
        ok: false,
        response: NextResponse.json({ error: 'insufficient_scope', required: requiredScope }, { status: 403 }),
      };
    }
    return {
      ok: true,
      ctx: {
        type: 'oauth',
        clientPkId: ctx.clientPkId,
        userId: ctx.userId,
        promoterId: ctx.promoterId,
        scopes: ctx.scopes,
      },
    };
  }

  // API key: tick_test_* | tick_live_*
  if (token.startsWith('tick_')) {
    const ctx = await verifyB2bToken(req);
    if (!ctx) {
      return {
        ok: false,
        response: NextResponse.json({ error: 'invalid_api_key' }, { status: 401 }),
      };
    }
    if (requiredScope && !ctx.scope.includes(requiredScope) && !ctx.scope.includes('*')) {
      return {
        ok: false,
        response: NextResponse.json({ error: 'insufficient_scope', required: requiredScope }, { status: 403 }),
      };
    }
    return {
      ok: true,
      ctx: {
        type: 'api_key',
        apiKeyId: ctx.keyId,
        userId: null,
        promoterId: ctx.promoterId,
        scopes: ctx.scope,
      },
    };
  }

  return {
    ok: false,
    response: NextResponse.json({ error: 'unsupported_token_format' }, { status: 401 }),
  };
}

/**
 * Rate limit check + log entry.
 */
export async function rateLimitCheck(ctx: ApiContext, endpoint: string, method: string): Promise<
  { ok: true } | { ok: false; response: NextResponse }
> {
  const idColumn = ctx.type === 'oauth' ? 'client_id' : 'api_key_id';
  const idValue = ctx.type === 'oauth' ? ctx.clientPkId : ctx.apiKeyId;
  if (!idValue) return { ok: true };

  // Get rate limit per hour (default 1000)
  const limitRes = await db().query<{ rate_limit_per_hour: number }>(
    ctx.type === 'oauth'
      ? `SELECT rate_limit_per_hour FROM b2b.oauth_clients WHERE id = $1`
      : `SELECT 1000 AS rate_limit_per_hour`,
    [idValue],
  );
  const limit = limitRes.rows[0]?.rate_limit_per_hour ?? 1000;

  // Count requests in last hour
  const cnt = await db().query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM b2b.api_rate_limit_log
      WHERE ${idColumn} = $1 AND created_at > now() - INTERVAL '1 hour'`,
    [idValue],
  );
  const used = Number(cnt.rows[0]?.count ?? 0);

  if (used >= limit) {
    return {
      ok: false,
      response: NextResponse.json({
        error: 'rate_limit_exceeded',
        limit, used,
      }, {
        status: 429,
        headers: {
          'X-RateLimit-Limit': String(limit),
          'X-RateLimit-Remaining': '0',
          'Retry-After': '3600',
        },
      }),
    };
  }

  // Log request (fire-and-forget)
  void db().query(
    `INSERT INTO b2b.api_rate_limit_log (${idColumn}, endpoint, method)
     VALUES ($1, $2, $3)`,
    [idValue, endpoint, method],
  ).catch(() => null);

  return { ok: true };
}

export function withRateLimitHeaders(response: NextResponse, ctx: ApiContext, limit: number, used: number): NextResponse {
  response.headers.set('X-RateLimit-Limit', String(limit));
  response.headers.set('X-RateLimit-Remaining', String(Math.max(0, limit - used - 1)));
  void ctx; // ctx pro budoucí auditing
  return response;
}
