/**
 * RlsPool — pg.Pool s automatickou RLS session context injection.
 *
 * Pattern: AsyncLocalStorage (cls-hooked alternative).
 *
 * Per-request middleware/helper nastaví promoterId do `tenantStore.run(...)`.
 * Pool.connect() pak na každém acquire-u clienta volá:
 *   SET LOCAL app.current_promoter_id = '<uuid>'
 *   (uvnitř transakce co wrapne celý callback)
 *
 * Endpointy NEMUSÍ refactor — `query()` API zůstává stejné jako pg.Pool.
 *
 * Použití:
 *
 *   import { runWithPromoterContext, db } from '@/lib/db/rls-pool';
 *
 *   // V route handleru:
 *   const ctx = await requirePromoter(req);
 *   return runWithPromoterContext(ctx.promoterId, async () => {
 *     const r = await db().query('SELECT * FROM catalog.events');
 *     return NextResponse.json(r.rows);
 *   });
 *
 * Bez `runWithPromoterContext` zůstává session var = NULL (RLS vrátí 0 rows
 * kromě public-policy fallbacks jako `OR status='published'`).
 */
import { AsyncLocalStorage } from 'async_hooks';
import { Pool, PoolClient, QueryConfig, QueryResult, QueryResultRow } from 'pg';

interface RlsContext {
  promoterId?: string;
  isPlatformAdmin?: boolean;
  // Fáze 2 (2026-06-01): existující policies používají i tyto konvence —
  // orders/tickets isolují přes app.current_user_id + app.role, proto je
  // context-setter musí umět nastavit taky (jinak buyer-facing RLS = 0 řádků).
  currentUserId?: string;
  role?: string; // 'service' | 'admin' | 'gate' | 'buyer' | 'promoter'
}

const tenantStore = new AsyncLocalStorage<RlsContext>();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROLE_RE = /^[a-z_]+$/; // allowlist tvar — SET LOCAL interpoluje string, nutná validace

let pool: Pool | null = null;

function getRawPool(): Pool {
  if (!pool) {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
  }
  return pool;
}

/**
 * Wrap async callback s promoter context.
 * Všechny `db().query()` volání uvnitř automaticky scoped na promoter_id.
 */
export function runWithPromoterContext<T>(
  promoterId: string,
  callback: () => Promise<T>,
): Promise<T> {
  if (!UUID_RE.test(promoterId)) {
    return Promise.reject(new Error('runWithPromoterContext: invalid promoterId UUID'));
  }
  // role 'promoter' = validní audit_log.actor_type (trigger čte app.role). Bez něj
  // by app.role zůstal prázdný a audit trigger na UPDATE orders/tickets by zapsal
  // actor_type='' → porušení audit_log_actor_type_check → 500 (např. refund).
  return tenantStore.run({ promoterId, role: 'promoter' }, callback);
}

/**
 * Wrap async callback s platform admin context (RLS bypass via policy).
 */
export function runWithPlatformAdminContext<T>(callback: () => Promise<T>): Promise<T> {
  return tenantStore.run({ isPlatformAdmin: true, role: 'admin' }, callback);
}

/**
 * Wrap async callback se SERVICE contextem (app.role='service' → app_is_service()
 * = plný přístup přes RLS). Pro trusted backend: cron, interní endpointy, webhooky
 * od platebních bran. NEpoužívat pro user-facing routes.
 */
export function runWithServiceContext<T>(callback: () => Promise<T>): Promise<T> {
  // role 'system' = validní audit_log.actor_type (trigger čte app.role) + app_is_service()
  return tenantStore.run({ role: 'system' }, callback);
}

/**
 * Wrap async callback s buyer (user) contextem — pro orders/tickets RLS,
 * které isolují přes app.current_user_id. Volitelný `role` ('service'/'gate').
 */
export function runWithUserContext<T>(
  userId: string,
  callback: () => Promise<T>,
  role?: string,
): Promise<T> {
  if (!UUID_RE.test(userId)) {
    return Promise.reject(new Error('runWithUserContext: invalid userId UUID'));
  }
  if (role !== undefined && !ROLE_RE.test(role)) {
    return Promise.reject(new Error('runWithUserContext: invalid role'));
  }
  // default role 'user' = validní audit_log.actor_type (trigger čte app.role)
  return tenantStore.run({ currentUserId: userId, role: role ?? 'user' }, callback);
}

/**
 * `db()` — drop-in replacement pro existující `new Pool(...)`.
 *
 * Vrací proxy objekt s `.query()` metodou co:
 *   1. Acquire raw client
 *   2. BEGIN + SET LOCAL session vars (z ALS contextu)
 *   3. Execute query
 *   4. COMMIT + release
 *
 * Pokud není context (volání mimo runWith*), query proběhne bez session
 * vars — RLS vrátí jen public-policy rows.
 */
class RlsAwarePool {
  async query<R extends QueryResultRow = QueryResultRow>(
    text: string | QueryConfig<unknown[]>,
    params?: unknown[],
  ): Promise<QueryResult<R>> {
    const ctx = tenantStore.getStore();
    const rawPool = getRawPool();

    if (!ctx || (!ctx.promoterId && !ctx.isPlatformAdmin && !ctx.currentUserId && !ctx.role)) {
      // Bez context — direct query (RLS vrátí jen public rows)
      return rawPool.query<R>(text as string, params);
    }

    const client = await rawPool.connect();
    try {
      await client.query('BEGIN');
      if (ctx.promoterId) {
        await client.query(`SET LOCAL app.current_promoter_id = '${ctx.promoterId}'`);
      }
      if (ctx.isPlatformAdmin) {
        await client.query(`SET LOCAL app.is_platform_admin = 'true'`);
      }
      if (ctx.currentUserId) {
        await client.query(`SET LOCAL app.current_user_id = '${ctx.currentUserId}'`);
      }
      if (ctx.role) {
        await client.query(`SET LOCAL app.role = '${ctx.role}'`);
      }
      const result = await client.query<R>(text as string, params);
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
   * Connect pro explicit transakce. Endpoint musí volat client.release().
   * Caller je zodpovědný za BEGIN/COMMIT/ROLLBACK + SET LOCAL.
   *
   * RLS session var se injectne automaticky před prvním query, pokud je
   * context aktivní.
   */
  async connect(): Promise<PoolClient> {
    const ctx = tenantStore.getStore();
    const client = await getRawPool().connect();

    if (ctx?.promoterId || ctx?.isPlatformAdmin || ctx?.currentUserId || ctx?.role) {
      // Set session-level (ne LOCAL) — bude reset-nuté při release
      if (ctx.promoterId) {
        await client.query(`SET app.current_promoter_id = '${ctx.promoterId}'`);
      }
      if (ctx.isPlatformAdmin) {
        await client.query(`SET app.is_platform_admin = 'true'`);
      }
      if (ctx.currentUserId) {
        await client.query(`SET app.current_user_id = '${ctx.currentUserId}'`);
      }
      if (ctx.role) {
        await client.query(`SET app.role = '${ctx.role}'`);
      }
      // Wrap release aby vyresetoval session vars
      const originalRelease = client.release.bind(client);
      (client as PoolClient & { release: typeof originalRelease }).release = ((
        err?: Error | boolean,
      ): void => {
        // Best-effort reset — connection se vrátí čistá do poolu
        void client
          .query(
            'RESET app.current_promoter_id; RESET app.is_platform_admin; RESET app.current_user_id; RESET app.role;',
          )
          .catch(() => undefined)
          .finally(() => originalRelease(err));
      }) as typeof originalRelease;
    }

    return client;
  }

  /**
   * Pure pass-through pro existující code co `pool.end()` volá při shutdown.
   */
  async end(): Promise<void> {
    if (pool) {
      await pool.end();
      pool = null;
    }
  }
}

const rlsPool = new RlsAwarePool();

/**
 * Drop-in replacement pro `new Pool(...)`:
 *
 *   - Před:  const pool = new Pool({ connectionString: ... });
 *            await pool.query(sql);
 *
 *   - Po:    import { db } from '@/lib/db/rls-pool';
 *            await db().query(sql);
 */
export function db(): RlsAwarePool {
  return rlsPool;
}

/**
 * Pro debug/test: získat aktuální RLS context (nebo undefined).
 */
export function getCurrentRlsContext(): RlsContext | undefined {
  return tenantStore.getStore();
}
