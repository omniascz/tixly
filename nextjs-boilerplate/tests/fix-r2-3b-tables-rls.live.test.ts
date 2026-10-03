// @vitest-environment node
/**
 * Kolo 2 / krok 3B — 156 tabulek bez RLS (audit L7).
 *
 * Strukturálně: po migraci 482 smí být bez RLS (a čitelné rolí tixly_app) JEN systémové /
 * číselníkové tabulky z uzavřeného seznamu (20) a ty mají pro tixly_app jen SELECT
 * (+ zápisy, které kód skutečně dělá). tixly_app nemá TRUNCATE nikde (TRUNCATE obchází RLS).
 *
 * Chováním (jako tixly_app, transakce s ROLLBACK): data tenantu B / uživatele Y nejsou
 * kontextu A čitelná ani zapisovatelná; vlastník svá data čte i mění; veřejné údaje
 * publikované akce čte i veřejnost.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool, type PoolClient } from 'pg';
import { randomUUID } from 'crypto';
import { createLocalClone, hasLocalDb, type LocalClone } from './helpers/local-fixture';

const run = describe.skipIf(!hasLocalDb);
const APP_URL = process.env.FIX_DB_APP_URL ?? 'postgresql://tixly_app:fixapp@localhost:55632/e2e';

/** Uzavřený seznam systémových/číselníkových tabulek, které ZŮSTÁVAJÍ bez RLS (rozhodnutí 3B). */
const SYSTEM: Record<string, string[]> = {
  'b2b.sandbox_fixtures': [], 'benefit_payments.providers': [], 'brands.advertisers': ['INSERT'],
  'brands.campaigns': ['INSERT', 'UPDATE'], 'catalog.moderation_blocklist': [], 'channels.channel_providers': [],
  'marketing.editorial_articles': ['INSERT', 'UPDATE'], 'marketing.transit_partners': [], 'marketing.web_vitals': ['INSERT'],
  'monitoring.status_incidents': [], 'monitoring.system_components': [], 'platform.config': [], 'platform.currencies': [],
  'platform.dashboard_widgets': [], 'platform.exchange_rates': [], 'platform.incident_updates': ['INSERT'],
  'platform.incidents': ['INSERT', 'UPDATE', 'DELETE'], 'resources.resource_hub': [], 'risk.fraud_rules': [], 'risk.velocity_limits': [],
};

type Ctx = { promoter?: string; user?: string };

run('Krok 3B — tabulky bez RLS: data tenantu a uživatelů izolována', () => {
  let clone: LocalClone;
  let owner: Pool;
  let app: Pool;

  beforeAll(async () => {
    clone = await createLocalClone();
    owner = clone.pool;
    app = new Pool({ connectionString: APP_URL, max: 2 });
  }, 120_000);
  afterAll(async () => { await app?.end(); await clone?.cleanup(); }, 30_000);

  async function as(ctx: Ctx, sql: string, params: unknown[] = []): Promise<number | 'DENIED' | string> {
    const cl: PoolClient = await app.connect();
    try {
      await cl.query('BEGIN');
      await cl.query(
        `SELECT set_config('app.current_promoter_id',$1,true), set_config('app.current_user_id',$2,true),
                set_config('app.role',$3,true), set_config('app.is_platform_admin','',true)`,
        [ctx.promoter ?? '', ctx.user ?? '', ctx.promoter ? 'promoter' : ctx.user ? 'user' : ''],
      );
      return (await cl.query(sql, params)).rowCount ?? 0;
    } catch (e) {
      const m = (e as Error).message;
      return /row-level security|permission denied/.test(m) ? 'DENIED' : m;
    } finally {
      await cl.query('ROLLBACK').catch(() => {});
      cl.release();
    }
  }
  const denied = (v: number | string) => v === 0 || v === 'DENIED';

  it('strukturálně: bez RLS zůstaly jen systémové tabulky (20) s minimálními právy; TRUNCATE nikde', async () => {
    const noRls = (await owner.query<{ t: string }>(
      `SELECT n.nspname||'.'||c.relname AS t FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE c.relkind='r' AND NOT c.relrowsecurity
          AND n.nspname NOT IN ('pg_catalog','information_schema','public','topology','tiger','tiger_data')
          AND has_table_privilege('tixly_app', c.oid, 'SELECT') ORDER BY 1`)).rows.map((r) => r.t);
    expect(noRls).toEqual(Object.keys(SYSTEM).sort());
    for (const [t, grants] of Object.entries(SYSTEM)) {
      const p = (await owner.query<{ i: boolean; u: boolean; d: boolean }>(
        `SELECT has_table_privilege('tixly_app',$1,'INSERT') i, has_table_privilege('tixly_app',$1,'UPDATE') u,
                has_table_privilege('tixly_app',$1,'DELETE') d`, [t])).rows[0];
      expect({ t, INSERT: p.i, UPDATE: p.u, DELETE: p.d }).toEqual({ t, INSERT: grants.includes('INSERT'), UPDATE: grants.includes('UPDATE'), DELETE: grants.includes('DELETE') });
    }
    const trunc = (await owner.query<{ n: number }>(
      `SELECT count(*)::int n FROM pg_class c WHERE c.relkind IN ('r','p') AND has_table_privilege('tixly_app', c.oid, 'TRUNCATE')`)).rows[0].n;
    expect(trunc, 'tixly_app nesmí mít TRUNCATE (obchází RLS)').toBe(0);
  });

  it('tenant: čekací listina (e-maily) akce B — pořadatel A ani veřejnost nečte/nemění, pořadatel B ano', async () => {
    const b = await clone.seed.chain();
    const a = await clone.seed.chain();
    const id = (await owner.query<{ id: string }>(
      `INSERT INTO orders.waiting_list (event_id, email, name, position) VALUES ($1,'cekatel@x.test','Čekatel',1) RETURNING id`, [b.eventId])).rows[0].id;
    for (const c of [{ promoter: a.promoterId }, {}] as Ctx[]) {
      expect(await as(c, `SELECT 1 FROM orders.waiting_list WHERE id=$1`, [id])).toSatisfy(denied);
      expect(await as(c, `UPDATE orders.waiting_list SET email='hack@x.test' WHERE id=$1`, [id])).toSatisfy(denied);
      expect(await as(c, `INSERT INTO orders.waiting_list (event_id, email, name, position) VALUES ($1,'x@x.test','X',2)`, [b.eventId])).toSatisfy(denied);
    }
    expect(await as({ promoter: b.promoterId }, `SELECT 1 FROM orders.waiting_list WHERE id=$1`, [id])).toBe(1);
    expect(await as({ promoter: b.promoterId }, `UPDATE orders.waiting_list SET status='offered' WHERE id=$1`, [id])).toBe(1);
  });

  it('tenant + veřejné čtení: menu foyer publikované akce B čte veřejnost, mění jen pořadatel B', async () => {
    const b = await clone.seed.chain(); // seed: status published
    const a = await clone.seed.chain();
    const id = (await owner.query<{ id: string }>(
      `INSERT INTO catalog.foyer_menu_items (event_id, name, price_halire) VALUES ($1,'Pivo',5000) RETURNING id`, [b.eventId])).rows[0].id;
    expect(await as({}, `SELECT 1 FROM catalog.foyer_menu_items WHERE id=$1`, [id]), 'veřejnost čte').toBe(1);
    for (const c of [{ promoter: a.promoterId }, {}] as Ctx[]) {
      expect(await as(c, `UPDATE catalog.foyer_menu_items SET price_halire=1 WHERE id=$1`, [id])).toSatisfy(denied);
      expect(await as(c, `INSERT INTO catalog.foyer_menu_items (event_id, name, price_halire) VALUES ($1,'Hack',1)`, [b.eventId])).toSatisfy(denied);
      expect(await as(c, `DELETE FROM catalog.foyer_menu_items WHERE id=$1`, [id])).toSatisfy(denied);
    }
    expect(await as({ promoter: b.promoterId }, `UPDATE catalog.foyer_menu_items SET price_halire=6000 WHERE id=$1`, [id])).toBe(1);
  });

  it('tenant: OAuth aplikace (secret) pořadatele B — pořadatel A nečte; kupec vidí jen aplikace, kterým udělil přístup', async () => {
    const b = await clone.seed.chain();
    const a = await clone.seed.chain();
    const cid = (await owner.query<{ id: string }>(
      `INSERT INTO b2b.oauth_clients (owner_promoter_id, client_id, client_secret_hash, app_name, redirect_uris)
       VALUES ($1,$2,'h','App B',ARRAY['https://b.example/cb']) RETURNING id`, [b.promoterId, `cl-${randomUUID()}`])).rows[0].id;
    const u = await clone.seed.user('oauthu', 'U');
    expect(await as({ promoter: a.promoterId }, `SELECT 1 FROM b2b.oauth_clients WHERE id=$1`, [cid])).toSatisfy(denied);
    expect(await as({ user: u.id }, `SELECT 1 FROM b2b.oauth_clients WHERE id=$1`, [cid])).toSatisfy(denied);
    expect(await as({ promoter: b.promoterId }, `SELECT 1 FROM b2b.oauth_clients WHERE id=$1`, [cid])).toBe(1);
  });

  it('uživatel: přátelství Y–Z nevidí ani nezmění X', async () => {
    const [x, y, z] = [await clone.seed.user('fx', 'X'), await clone.seed.user('fy', 'Y'), await clone.seed.user('fz', 'Z')];
    const [ua, ub] = [y.id, z.id].sort();
    await owner.query(`INSERT INTO social_graph.friendships (user_a, user_b) VALUES ($1,$2)`, [ua, ub]);
    expect(await as({ user: x.id }, `SELECT 1 FROM social_graph.friendships WHERE user_a=$1 AND user_b=$2`, [ua, ub])).toSatisfy(denied);
    expect(await as({ user: x.id }, `DELETE FROM social_graph.friendships WHERE user_a=$1 AND user_b=$2`, [ua, ub])).toSatisfy(denied);
    expect(await as({ user: y.id }, `SELECT 1 FROM social_graph.friendships WHERE user_a=$1 AND user_b=$2`, [ua, ub])).toBe(1);
  });

  it('zamčená data (nepoužívaná kódem): výplaty affiliate — žádný tenantní ani uživatelský kontext', async () => {
    const b = await clone.seed.chain();
    const u = await clone.seed.user('aff', 'Aff');
    const affId = (await owner.query<{ id: string }>(`INSERT INTO affiliate.affiliates (user_id, promoter_id) VALUES ($1,$2) RETURNING id`, [u.id, b.promoterId])).rows[0].id;
    const pid = (await owner.query<{ id: string }>(`INSERT INTO affiliate.payouts (affiliate_id, amount) VALUES ($1, 1000) RETURNING id`, [affId])).rows[0].id;
    for (const c of [{ promoter: b.promoterId }, { user: u.id }, {}] as Ctx[]) {
      expect(await as(c, `SELECT 1 FROM affiliate.payouts WHERE id=$1`, [pid])).toSatisfy(denied);
      expect(await as(c, `UPDATE affiliate.payouts SET amount=999999 WHERE id=$1`, [pid])).toSatisfy(denied);
    }
  });

  it('auditní log: pořadatel A nečte stopu pořadatele B; zápis (append) smí', async () => {
    const b = await clone.seed.chain();
    const a = await clone.seed.chain();
    const id = (await owner.query<{ id: string }>(
      `INSERT INTO audit.audit_log (schema_name, table_name, record_id, action, actor_id, actor_type, new_values)
       VALUES ('catalog','events',$1,'UPDATE',$2,'promoter','{"x":1}') RETURNING id::text`, [b.eventId, b.adminUserId])).rows[0].id;
    expect(await as({ promoter: a.promoterId }, `SELECT 1 FROM audit.audit_log WHERE id=$1::bigint`, [id])).toSatisfy(denied);
    expect(await as({ promoter: b.promoterId }, `SELECT 1 FROM audit.audit_log WHERE id=$1::bigint`, [id])).toBe(1);
    expect(await as({ promoter: a.promoterId }, `INSERT INTO audit.audit_log (schema_name, table_name, record_id, action, actor_type) VALUES ('x','y','z','INSERT','promoter')`)).toBe(1);
  });

  it('systémová tabulka: čtení ano, zápis bez práva', async () => {
    expect(await as({}, `SELECT 1 FROM platform.currencies LIMIT 1`)).not.toBe('DENIED');
    expect(await as({ promoter: randomUUID() }, `INSERT INTO platform.currencies (code, name) VALUES ('XXX','Hack')`)).toBe('DENIED');
    expect(await as({}, `UPDATE platform.config SET value=value`)).toBe('DENIED');
  });
});
