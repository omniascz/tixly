/**
 * E2E test for withTenantContext — verifies cross-tenant isolation against a
 * real PostgreSQL instance with Row Level Security policies.
 *
 * Auto-skips when DATABASE_URL is not set, so CI without a DB stays green.
 *
 * Run manually:
 *   DATABASE_URL=postgres://localhost/test pnpm --filter @tixly/rls-multitenancy test
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool, type PoolClient } from 'pg';
import { withTenantContext } from '../lib/tenant-context';
import type { DbAdapter } from '../lib/service-container';
import { promoterContext } from '../lib/tenant-helpers';

const DATABASE_URL = process.env.DATABASE_URL;
const PROMOTER_A = '11111111-1111-1111-1111-111111111111';
const PROMOTER_B = '22222222-2222-2222-2222-222222222222';
const USER_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const USER_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const SCHEMA = 'rls_e2e_test';

function wrapPool(pool: Pool): DbAdapter {
  const adapter: DbAdapter = {
    async query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]> {
      const res = await pool.query(sql, params as unknown[]);
      return res.rows as T[];
    },
    async execute(sql: string, params?: unknown[]): Promise<void> {
      await pool.query(sql, params as unknown[]);
    },
    async transaction<T>(fn: (tx: DbAdapter) => Promise<T>): Promise<T> {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const tx = wrapClient(client);
        const result = await fn(tx);
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    },
  };
  return adapter;
}

function wrapClient(client: PoolClient): DbAdapter {
  return {
    async query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]> {
      const res = await client.query(sql, params as unknown[]);
      return res.rows as T[];
    },
    async execute(sql: string, params?: unknown[]): Promise<void> {
      await client.query(sql, params as unknown[]);
    },
    async transaction<T>(fn: (tx: DbAdapter) => Promise<T>): Promise<T> {
      return fn(wrapClient(client));
    },
  };
}

describe.skipIf(!DATABASE_URL)('withTenantContext — RLS isolation (E2E)', () => {
  let pool: Pool;
  let db: DbAdapter;

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });
    db = wrapPool(pool);

    await pool.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await pool.query(`CREATE SCHEMA ${SCHEMA}`);
    await pool.query(`
      CREATE TABLE ${SCHEMA}.items (
        id SERIAL PRIMARY KEY,
        promoter_id UUID NOT NULL,
        name TEXT NOT NULL
      )
    `);
    await pool.query(`ALTER TABLE ${SCHEMA}.items ENABLE ROW LEVEL SECURITY`);
    await pool.query(`ALTER TABLE ${SCHEMA}.items FORCE ROW LEVEL SECURITY`);
    await pool.query(`
      CREATE POLICY items_tenant_isolation ON ${SCHEMA}.items
        USING (
          current_setting('app.current_role', true) = 'service'
          OR promoter_id::text = current_setting('app.current_promoter_id', true)
        )
    `);

    await pool.query(
      `INSERT INTO ${SCHEMA}.items (promoter_id, name) VALUES
        ($1, 'A-item-1'), ($1, 'A-item-2'),
        ($2, 'B-item-1'), ($2, 'B-item-2')`,
      [PROMOTER_A, PROMOTER_B],
    );
  });

  afterAll(async () => {
    if (pool) {
      await pool.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
      await pool.end();
    }
  });

  it('promoter A sees only their own rows', async () => {
    const rows = await withTenantContext(
      db,
      promoterContext(PROMOTER_A, USER_A),
      async (tx) => tx.query<{ name: string }>(`SELECT name FROM ${SCHEMA}.items ORDER BY name`),
    );
    expect(rows.map((r) => r.name)).toEqual(['A-item-1', 'A-item-2']);
  });

  it('promoter B sees only their own rows', async () => {
    const rows = await withTenantContext(
      db,
      promoterContext(PROMOTER_B, USER_B),
      async (tx) => tx.query<{ name: string }>(`SELECT name FROM ${SCHEMA}.items ORDER BY name`),
    );
    expect(rows.map((r) => r.name)).toEqual(['B-item-1', 'B-item-2']);
  });

  it('service role sees all rows (bypass via policy)', async () => {
    const rows = await withTenantContext(
      db,
      { role: 'service' },
      async (tx) => tx.query<{ name: string }>(`SELECT name FROM ${SCHEMA}.items ORDER BY name`),
    );
    expect(rows.map((r) => r.name)).toEqual(['A-item-1', 'A-item-2', 'B-item-1', 'B-item-2']);
  });

  it('UPDATE from promoter A cannot touch promoter B rows', async () => {
    await withTenantContext(db, promoterContext(PROMOTER_A), async (tx) => {
      await tx.execute(`UPDATE ${SCHEMA}.items SET name = name || '-touched'`);
    });

    const all = await pool.query<{ promoter_id: string; name: string }>(
      `SELECT promoter_id, name FROM ${SCHEMA}.items ORDER BY name`,
    );
    const bRows = all.rows.filter((r) => r.promoter_id === PROMOTER_B);
    expect(bRows.every((r) => !r.name.endsWith('-touched'))).toBe(true);
  });
});
