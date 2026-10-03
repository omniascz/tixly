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
let connectPool: Pool | null = null;

/**
 * R-56 (kolo 2, krok 4): RLS kontext platí VÝHRADNĚ v rámci transakce, ve všech cestách
 * a bez podmínky na tvar URL.
 *
 * Dřív: `query()` byl těsný (BEGIN + SET LOCAL + dotaz + COMMIT), ale `connect()` nastavoval
 * GUC session-level (`set_config(..., false)`) a spoléhal na samostatný „přímý" pool
 * (`DATABASE_URL_DIRECT` nebo host s `-pooler.`). Když se přímé URL neodvodilo, šel connect()
 * přes transakční pooler a dotazy volajícího dorazily na backend s CIZÍM kontextem
 * (audit V9: 40/60; test kola 2: 173/200 resp. 193/200 požadavků vidělo cizí data).
 *
 * Teď: GUC se v obou cestách nastavují `set_config(..., true)` uvnitř
 * transakce, ve které dotaz běží (u connect() hned po BEGIN volajícího; samostatné příkazy
 * mimo transakci se obalí implicitní transakcí). Po COMMIT/ROLLBACK kontext zaniká sám —
 * spojení vrácené do poolu (i backend v PgBounceru) žádný kontext nenese.
 */
/**
 * Kolo 3 (regrese kola 2): connect() má VLASTNÍ pool. Routy drží klienta z connect() v transakci
 * a uvnitř volají db().query() — se sdíleným poolem si pod souběhem všichni drželi jedno spojení
 * a čekali na druhé → deadlock „timeout exceeded when trying to connect" (audit E2E 05: 98/100 500).
 * Oddělené pooly vnořené výpůjčky nezablokují. Bezpečnost R-56 nese transakčně lokální kontext,
 * takže na URL nezáleží: DATABASE_URL_DIRECT se použije, je-li nastaven (šetří pooler), jinak
 * DATABASE_URL — oba jsou bezpečné.
 */
function getConnectPool(): Pool {
  if (!connectPool) {
    connectPool = new Pool({
      connectionString: process.env.DATABASE_URL_DIRECT || process.env.DATABASE_URL,
      max: Number(process.env.PG_DIRECT_POOL_MAX ?? 4),
      statement_timeout: Number(process.env.PG_STATEMENT_TIMEOUT_MS ?? 15000),
      connectionTimeoutMillis: 8000,
      idleTimeoutMillis: Number(process.env.PG_DIRECT_IDLE_TIMEOUT_MS ?? 10000),
    });
  }
  return connectPool;
}

function getRawPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      // Concurrency safety net (po load testu): omezený pool + timeouty, aby se
      // pod onsale náporem nehromadily zaseknuté transakce (viděno: 27 zombie lock-waiterů).
      max: Number(process.env.PG_POOL_MAX ?? 10),
      // Jakákoli query (vč. čekání na zámek) spadne po 15s → transakce rollbackne,
      // spojení se uvolní. Bez tohohle se pool zasekl donekonečna.
      statement_timeout: Number(process.env.PG_STATEMENT_TIMEOUT_MS ?? 15000),
      connectionTimeoutMillis: 8000,
      // Prepinatelne kvuli R-15 (§118): mereni, jestli za zamenou spojeni stoji
      // vyhazovani necinnych spojeni z poolu.
      idleTimeoutMillis: Number(process.env.PG_IDLE_TIMEOUT_MS ?? 30000),
    });
    if (process.env.RLS_POOL_DEBUG === '1') {
      pool.on('error', (e) => console.warn('[POOL-ERROR]', (e as Error)?.message?.slice(0, 80)));
      pool.on('remove', () => console.warn('[POOL-REMOVE] spojeni odstraneno z poolu'));
    }
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
 * Kolo 3: zápis „jménem" konkrétního uživatele uvnitř transakce, jejíž identitu prokázal
 * jiný mechanismus než session (např. OAuth `state` v callbacku, který běží bez přihlášení).
 * Na dobu `fn` nastaví `app.current_user_id` = userId a `app.role` = 'user' (transakčně
 * lokálně) → platí RLS politiky VLASTNÍCH řádků toho uživatele, nic víc. Pak vrátí původní.
 */
export async function asUserInTx<T>(client: PoolClient, userId: string, fn: () => Promise<T>): Promise<T> {
  const prev = (await client.query<{ u: string | null; r: string | null }>(
    `SELECT current_setting('app.current_user_id', true) AS u, current_setting('app.role', true) AS r`,
  )).rows[0];
  await client.query(`SELECT set_config('app.current_user_id', $1, true), set_config('app.role', 'user', true)`, [userId]);
  try {
    return await fn();
  } finally {
    await client.query(`SELECT set_config('app.current_user_id', $1, true), set_config('app.role', $2, true)`,
      [prev?.u ?? '', prev?.r ?? '']).catch(() => undefined);
  }
}

/**
 * Kolo 2 / V8: systémový vedlejší efekt akce kupce UVNITŘ jeho transakce.
 *
 * Politiky kupci záměrně nedovolí měnit kapacitu (`catalog.ticket_types`), sedadla
 * (`catalog.event_seats`) ani vkládat objednávky/vstupenky — to smí jen pořadatel, admin
 * a systém. Některé akce kupce ale systémový efekt nutně mají (storno vrací kapacitu,
 * rezervace drží sedadlo). Ty běží přes tento helper: na dobu `fn` přepne `app.role`
 * na 'system' JEN v rámci aktuální transakce (`set_config(..., true)`) a pak ji vrátí.
 *
 * Pravidla použití: `client` MUSÍ být uvnitř `BEGIN`; vlastnictví/oprávnění kupce se
 * ověří DŘÍV pod jeho RLS kontextem; `fn` obsahuje jen konkrétní systémové příkazy
 * odvozené z ověřených dat (ne obecné dotazy).
 */
export async function asSystemInTx<T>(client: PoolClient, fn: () => Promise<T>): Promise<T> {
  const prev = (await client.query<{ r: string | null }>(`SELECT current_setting('app.role', true) AS r`)).rows[0]?.r ?? '';
  await client.query(`SELECT set_config('app.role', 'system', true)`);
  try {
    return await fn();
  } finally {
    // Při chybě v `fn` je transakce abortovaná a příkaz selže — volající stejně dělá ROLLBACK,
    // který lokální nastavení zahodí; původní chybu nepřebíjíme.
    await client.query(`SELECT set_config('app.role', $1, true)`, [prev]).catch(() => undefined);
  }
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

/**
 * Nastaví VŠECHNY čtyři RLS GUC TRANSAKČNĚ LOKÁLNĚ (`set_config(..., true)`) a v TÉMŽ
 * dotazu je přečte zpátky (§121). Volá se jen UVNITŘ transakce — po COMMIT/ROLLBACK
 * hodnoty zaniknou, takže spojení vrácené do poolu nikdy nenese cizí kontext (R-56).
 *
 * Nenastavené GUC se nastavují na '' (prázdný řetězec), NE se vynechávají:
 * helpery dělají NULLIF(current_setting(...),'')::uuid, takže '' -> NULL a žádné
 * 22P02 (§111). Zpětné čtení je tak jednoznačné.
 */
/** SQL literál; hodnoty jsou validované (UUID_RE / ROLE_RE / boolean), uvozovky přesto escapujeme. */
const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`;

/**
 * Jeden round-trip: `BEGIN` + set_config(..., true) všech čtyř GUC + zpětné čtení (§121).
 * Simple-query multi-statement (bez parametrů) — proto literály z validovaných hodnot.
 * Vrací výsledek `BEGIN` (pro volajícího, který ho poslal sám).
 */
async function beginWithGucs(
  q: (text: string) => Promise<QueryResult | QueryResult[]>,
  ctx: { promoterId?: string; isPlatformAdmin?: boolean; currentUserId?: string; role?: string },
  beginSql = 'BEGIN',
): Promise<QueryResult> {
  const want: Array<[string, string]> = [
    ['app.current_promoter_id', ctx.promoterId ?? ''],
    ['app.is_platform_admin', ctx.isPlatformAdmin ? 'true' : ''],
    ['app.current_user_id', ctx.currentUserId ?? ''],
    ['app.role', ctx.role ?? ''],
  ];
  const sets = want.map(([n, v], i) => `set_config(${lit(n)}, ${lit(v)}, true) AS s${i}`).join(', ');
  const reads = want.map(([n], i) => `current_setting(${lit(n)}, true) AS r${i}`).join(', ');
  const res = await q(`${beginSql.trim().replace(/;\s*$/, '')}; SELECT ${sets}; SELECT ${reads}`);
  const arr = Array.isArray(res) ? res : [res];
  const row = arr[arr.length - 1].rows[0] as Record<string, string | null>;
  if (!want.every(([, v], i) => (row[`r${i}`] ?? null) === v)) {
    // nikdy tiché prázdno / cizí kontext — chyba
    throw new Error('rls-pool: RLS kontext se nepodařilo nastavit v transakci');
  }
  return arr[0];
}

// Originální client.query (pg-pool při vypůjčení obnovuje jen release(), query NE —
// bez tohohle by se wrapper vrstvil na wrapper předchozího držitele spojení).
const ORIG_QUERY = Symbol('rls-pool.origQuery');

const hasCtx = (ctx: RlsContext | undefined): ctx is RlsContext =>
  !!ctx && !!(ctx.promoterId || ctx.isPlatformAdmin || ctx.currentUserId || ctx.role);
const TX_BEGIN_RE = /^\s*(BEGIN|START\s+TRANSACTION)\b/i;
// ROLLBACK TO [SAVEPOINT] transakci NEukončuje
const TX_END_RE = /^\s*(COMMIT|END|ABORT|ROLLBACK(?!\s+TO\b))\b/i;

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
   * Klient pro explicitní transakce. Endpoint musí volat client.release().
   *
   * R-56 (kolo 2): stejný pool jako query(); kontext (je-li aktivní) se nastaví
   * TRANSAKČNĚ LOKÁLNĚ:
   *   - `BEGIN` / `START TRANSACTION` volajícího → hned po něm set_config(..., true)
   *   - příkaz MIMO transakci (autocommit) → obalí se implicitní transakcí
   *     BEGIN; set_config(..., true); příkaz; COMMIT — kontext i příkaz na témže backendu
   *   - release() s otevřenou transakcí → ROLLBACK před vrácením do poolu
   * Session-level GUC se už nenastavují vůbec → není co resetovat a nic nemůže uniknout
   * k dalšímu držiteli spojení (ani přes transakční pooler bez DATABASE_URL_DIRECT).
   */
  async connect(): Promise<PoolClient> {
    const ctx = tenantStore.getStore();
    const client = await getConnectPool().connect();
    type Q = PoolClient['query'];
    const holder = client as PoolClient & { [ORIG_QUERY]?: Q };
    // vždy začít z čistého pg query (i když předchozí držitel spojení měl wrapper)
    if (holder[ORIG_QUERY]) (client as { query: Q }).query = holder[ORIG_QUERY]!;
    if (!hasCtx(ctx)) return client;
    const snapshot = { ...ctx };

    holder[ORIG_QUERY] = client.query;
    const origQuery = client.query.bind(client) as unknown as (t: unknown, p?: unknown) => Promise<QueryResult>;
    const q = (t: string, p?: unknown[]) => origQuery(t, p);
    const qs = (t: string) => origQuery(t) as Promise<QueryResult | QueryResult[]>;
    let inTx = false;

    const wrapped = (async (text: unknown, params?: unknown) => {
      const sql = typeof text === 'string' ? text
        : text && typeof (text as { text?: unknown }).text === 'string' ? (text as { text: string }).text : null;
      if (sql === null) return origQuery(text, params); // Submittable (cursor/stream) — beze změny
      if (TX_BEGIN_RE.test(sql) && params === undefined) {
        const r = await beginWithGucs(qs, snapshot, sql);
        inTx = true;
        return r;
      }
      if (TX_END_RE.test(sql)) {
        try { return await origQuery(text, params); } finally { inTx = false; }
      }
      if (inTx) return origQuery(text, params);
      await beginWithGucs(qs, snapshot);
      try {
        const r = await origQuery(text, params);
        await q('COMMIT');
        return r;
      } catch (e) {
        await q('ROLLBACK').catch(() => undefined);
        throw e;
      }
    }) as unknown as Q;
    (client as { query: Q }).query = wrapped;

    const originalRelease = client.release.bind(client);
    let releasedOnce = false;
    (client as PoolClient & { release: typeof originalRelease }).release = ((err?: Error | boolean): void => {
      if (releasedOnce) return; // dvojité release je chyba volajícího — druhé ignorovat
      releasedOnce = true;
      const restore = () => { (client as { query: Q }).query = holder[ORIG_QUERY]!; };
      if (inTx && !err) {
        // volající zapomněl COMMIT/ROLLBACK — nevracet do poolu otevřenou transakci
        inTx = false;
        void q('ROLLBACK').catch(() => undefined).finally(() => { restore(); originalRelease(err); });
        return;
      }
      restore();
      originalRelease(err);
    }) as typeof originalRelease;

    return client;
  }

  /**
   * Pure pass-through pro existující code co `pool.end()` volá při shutdown.
   */
  async end(): Promise<void> {
    const konce: Array<Promise<void>> = [];
    if (pool) { konce.push(pool.end()); pool = null; }
    if (connectPool) { konce.push(connectPool.end()); connectPool = null; }
    await Promise.all(konce);
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
