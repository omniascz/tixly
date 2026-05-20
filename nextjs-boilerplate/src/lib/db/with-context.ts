/**
 * DB connection helpers s RLS session context.
 *
 * Bez SET LOCAL session vars RLS policy z migrace 285 vrátí 0 rows.
 * Tyto helpery acquire client → set context → callback → release.
 *
 * Použití místo `db().query(...)`:
 *
 *   import { withPromoterDb, withPlatformAdminDb, withAnonDb } from '@/lib/db/with-context';
 *
 *   await withPromoterDb(ctx.promoterId, async (client) => {
 *     const r = await client.query('SELECT * FROM catalog.events');
 *     // RLS automaticky scoped na promoter_id = ctx.promoterId
 *   });
 *
 *   await withPlatformAdminDb(async (client) => {
 *     // RLS bypass (vidí všechno)
 *   });
 *
 *   await withAnonDb(async (client) => {
 *     // Veřejné queries — RLS vrátí jen published events
 *   });
 *
 * Pro single query convenience:
 *   queryAsPromoter(promoterId, sql, params)
 *   queryAsPlatformAdmin(sql, params)
 */
import { Pool, PoolClient } from 'pg';

let pool: Pool | null = null;
function getPool(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Acquire client + SET LOCAL session vars uvnitř transakce.
 * RLS policy `promoter_id = app_current_promoter_id()` se aplikuje.
 */
export async function withPromoterDb<T>(
  promoterId: string,
  callback: (client: PoolClient) => Promise<T>,
): Promise<T> {
  if (!UUID_RE.test(promoterId)) {
    throw new Error('withPromoterDb: invalid promoterId UUID');
  }
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    // SET LOCAL vyžaduje transakci — bez BEGIN by setting persistoval na connection
    // (= leak do dalšího requestu po release).
    await client.query(`SET LOCAL app.current_promoter_id = '${promoterId}'`);
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Platform admin connection — RLS policy `app_is_platform_admin()` vrátí true.
 */
export async function withPlatformAdminDb<T>(
  callback: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL app.is_platform_admin = 'true'`);
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Anonymous (unauthenticated) connection. Bez session vars → RLS policy
 * jen exposes `status = 'published'` rows (viz catalog.events policy).
 */
export async function withAnonDb<T>(
  callback: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await getPool().connect();
  try {
    const result = await callback(client);
    return result;
  } finally {
    client.release();
  }
}

// Convenience pro single-query patterns

export async function queryAsPromoter<R extends Record<string, unknown> = Record<string, unknown>>(
  promoterId: string,
  sql: string,
  params?: unknown[],
): Promise<{ rows: R[] }> {
  return withPromoterDb(promoterId, async (client) => {
    return client.query<R>(sql, params);
  });
}

export async function queryAsPlatformAdmin<R extends Record<string, unknown> = Record<string, unknown>>(
  sql: string,
  params?: unknown[],
): Promise<{ rows: R[] }> {
  return withPlatformAdminDb(async (client) => {
    return client.query<R>(sql, params);
  });
}

export async function queryAnon<R extends Record<string, unknown> = Record<string, unknown>>(
  sql: string,
  params?: unknown[],
): Promise<{ rows: R[] }> {
  return withAnonDb(async (client) => {
    return client.query<R>(sql, params);
  });
}
