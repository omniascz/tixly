/**
 * B2B API authentication helper.
 *
 * Bearer token format: `tick_<env>_<hex>` (e.g. `tick_test_abc123...`).
 * - `tick_test_*` — sandbox/staging keys
 * - `tick_live_*` — production keys
 *
 * Validace přes `b2b.api_keys` tabulku (migrace 274). Pro M1 launch keys
 * provisionuje master admin přes `/platform/api-keys` UI (ne v této session).
 *
 * Rate limiting: per-key sliding window v Redis (TODO migrace 275 + integrace
 * s `@tixly/rate-limiter`).
 *
 * Tento helper je stub-friendly: pokud `b2b.api_keys` tabulka neexistuje
 * nebo token nesedí, vrací null → caller musí vrátit 401.
 */
import type { NextRequest } from 'next/server';
import { createHash } from 'node:crypto';

export interface B2bAuthContext {
  keyId: string;
  promoterId: string;
  scope: string[];
  rateLimit: {
    limit: number;
    remaining: number;
    resetUnix: number;
  };
}

const TOKEN_REGEX = /^tick_(test|live)_[a-f0-9]{32,64}$/;

/**
 * Validate Bearer token z `Authorization` header.
 * Vrátí context pokud platný, jinak null.
 */
export async function verifyB2bToken(req: NextRequest): Promise<B2bAuthContext | null> {
  const header = req.headers.get('authorization');
  if (!header || !header.startsWith('Bearer ')) return null;
  const token = header.slice(7).trim();
  if (!TOKEN_REGEX.test(token)) return null;

  // Hash token pro DB lookup (nikdy neukládáme plaintext)
  const tokenHash = createHash('sha256').update(token).digest('hex');

  // DB lookup — graceful fallback pokud tabulka ještě neexistuje (migrace 274)
  try {
    const { Pool } = await import('pg');
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const res = await pool.query<{
      id: string;
      promoter_id: string;
      scope: string[];
      revoked_at: string | null;
    }>(
      `SELECT id, promoter_id, scope, revoked_at
         FROM b2b.api_keys
        WHERE token_hash = $1 AND revoked_at IS NULL
        LIMIT 1`,
      [tokenHash],
    );
    await pool.end();

    if (res.rows.length === 0) return null;
    const row = res.rows[0]!;
    if (row.revoked_at) return null;

    return {
      keyId: row.id,
      promoterId: row.promoter_id,
      scope: row.scope ?? [],
      rateLimit: {
        limit: 1000,
        remaining: 999, // TODO real per-key sliding window
        resetUnix: Math.floor(Date.now() / 1000) + 60,
      },
    };
  } catch {
    return null;
  }
}

/**
 * Standard rate-limit headers + CORS hlavičky pro B2B response.
 */
export function b2bResponseHeaders(ctx?: B2bAuthContext | null): HeadersInit {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Origin': '*',
    'X-RateLimit-Limit': String(ctx?.rateLimit.limit ?? 100),
    'X-RateLimit-Remaining': String(ctx?.rateLimit.remaining ?? 0),
    'X-RateLimit-Reset': String(ctx?.rateLimit.resetUnix ?? Math.floor(Date.now() / 1000)),
  };
  return headers;
}
