/**
 * Tests for withTenantContext
 *
 * Ověřuje:
 * - Správné nastavení SET LOCAL session proměnných
 * - Pořadí volání SET LOCAL
 * - Předání DB adapteru do fn()
 * - Návratová hodnota fn() je vrácena z withTenantContext
 * - Rollback při chybě v fn()
 * - UUID validaci (SQL injection prevence)
 * - Edge cases: undefined promoterId/userId, různé role
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { withTenantContext } from '../lib/tenant-context';
import type { DbAdapter } from '../lib/service-container';
import type { TenantContext } from '../types/tenant';

// ─── Mock DB adapter factory ───────────────────────────────────────────────

interface ExecuteCall {
  sql: string;
  params?: unknown[];
}

function createMockDb(options?: { transactionShouldFail?: boolean }): {
  db: DbAdapter;
  executeCalls: ExecuteCall[];
  queryCalls: ExecuteCall[];
} {
  const executeCalls: ExecuteCall[] = [];
  const queryCalls: ExecuteCall[] = [];

  const db: DbAdapter = {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      queryCalls.push({ sql, params });
      return [];
    }),
    execute: vi.fn(async (sql: string, params?: unknown[]) => {
      executeCalls.push({ sql, params });
    }),
    transaction: vi.fn(async (fn: (tx: DbAdapter) => Promise<unknown>) => {
      if (options?.transactionShouldFail) {
        throw new Error('Transaction failed');
      }
      // Transakce předá stejný db adapter (simulace scoped tx)
      return fn(db);
    }),
  };

  return { db, executeCalls, queryCalls };
}

// ─── Test UUIDs ────────────────────────────────────────────────────────────

const PROMOTER_UUID = '550e8400-e29b-41d4-a716-446655440000';
const USER_UUID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('withTenantContext', () => {
  // ── SET LOCAL volání ──────────────────────────────────────────────────

  it('nastaví SET LOCAL pro role=service bez promoterId/userId', async () => {
    const { db, executeCalls } = createMockDb();
    const context: TenantContext = { role: 'service' };

    await withTenantContext(db, context, async () => undefined);

    const sqls = executeCalls.map((c) => c.sql);
    expect(sqls).toContain(`SET LOCAL app.current_promoter_id = ''`);
    expect(sqls).toContain(`SET LOCAL app.current_user_id = ''`);
    expect(sqls).toContain(`SET LOCAL app.current_role = 'service'`);
  });

  it('nastaví SET LOCAL promoterId pro role=promoter', async () => {
    const { db, executeCalls } = createMockDb();
    const context: TenantContext = {
      role: 'promoter',
      promoterId: PROMOTER_UUID,
      userId: USER_UUID,
    };

    await withTenantContext(db, context, async () => undefined);

    const sqls = executeCalls.map((c) => c.sql);
    expect(sqls).toContain(`SET LOCAL app.current_promoter_id = '${PROMOTER_UUID}'`);
    expect(sqls).toContain(`SET LOCAL app.current_user_id = '${USER_UUID}'`);
    expect(sqls).toContain(`SET LOCAL app.current_role = 'promoter'`);
  });

  it('nastaví SET LOCAL userId pro role=buyer', async () => {
    const { db, executeCalls } = createMockDb();
    const context: TenantContext = { role: 'buyer', userId: USER_UUID };

    await withTenantContext(db, context, async () => undefined);

    const sqls = executeCalls.map((c) => c.sql);
    expect(sqls).toContain(`SET LOCAL app.current_user_id = '${USER_UUID}'`);
    expect(sqls).toContain(`SET LOCAL app.current_role = 'buyer'`);
    expect(sqls).toContain(`SET LOCAL app.current_promoter_id = ''`);
  });

  it('SET LOCAL se volají ve správném pořadí: promoter_id, user_id, role', async () => {
    const { db, executeCalls } = createMockDb();
    const context: TenantContext = {
      role: 'promoter',
      promoterId: PROMOTER_UUID,
      userId: USER_UUID,
    };

    await withTenantContext(db, context, async () => undefined);

    const sqlsInOrder = executeCalls.map((c) => c.sql);
    const promoterIdx = sqlsInOrder.findIndex((s) => s.includes('current_promoter_id'));
    const userIdx = sqlsInOrder.findIndex((s) => s.includes('current_user_id'));
    const roleIdx = sqlsInOrder.findIndex((s) => s.includes('current_role'));

    expect(promoterIdx).toBeLessThan(userIdx);
    expect(userIdx).toBeLessThan(roleIdx);
  });

  // ── fn() volání ───────────────────────────────────────────────────────

  it('fn() dostane DB adapter a může provádět dotazy', async () => {
    const { db, queryCalls } = createMockDb();
    const context: TenantContext = { role: 'service' };

    await withTenantContext(db, context, async (tenantDb) => {
      await tenantDb.query('SELECT * FROM catalog.events');
    });

    expect(queryCalls).toHaveLength(1);
    expect(queryCalls[0].sql).toBe('SELECT * FROM catalog.events');
  });

  it('vrátí výsledek fn() jako výsledek withTenantContext', async () => {
    const { db } = createMockDb();
    const context: TenantContext = { role: 'service' };
    const expectedResult = [{ id: '1', name: 'Test Event' }];

    const result = await withTenantContext(db, context, async () => expectedResult);

    expect(result).toEqual(expectedResult);
  });

  it('vrátí složitý výsledek fn() (pole objektů)', async () => {
    const { db } = createMockDb();
    const context: TenantContext = { role: 'promoter', promoterId: PROMOTER_UUID, userId: USER_UUID };

    const result = await withTenantContext(db, context, async () => ({
      events: [{ id: '1' }, { id: '2' }],
      total: 2,
    }));

    expect(result).toEqual({ events: [{ id: '1' }, { id: '2' }], total: 2 });
  });

  // ── Transakce ─────────────────────────────────────────────────────────

  it('volá db.transaction()', async () => {
    const { db } = createMockDb();
    const context: TenantContext = { role: 'service' };

    await withTenantContext(db, context, async () => undefined);

    expect(db.transaction).toHaveBeenCalledTimes(1);
  });

  it('SET LOCAL volání jsou uvnitř transakce (před fn())', async () => {
    const callOrder: string[] = [];
    const db: DbAdapter = {
      query: vi.fn(async () => []),
      execute: vi.fn(async (sql: string) => {
        callOrder.push(`execute:${sql.split(' ')[3]}`);
      }),
      transaction: vi.fn(async (fn: (tx: DbAdapter) => Promise<unknown>) => {
        callOrder.push('transaction:start');
        const result = await fn(db);
        callOrder.push('transaction:end');
        return result;
      }),
    };

    await withTenantContext(db, { role: 'service' }, async () => {
      callOrder.push('fn:called');
    });

    const txStart = callOrder.indexOf('transaction:start');
    const fnCalled = callOrder.indexOf('fn:called');
    const txEnd = callOrder.indexOf('transaction:end');

    // SET LOCAL se volají po transaction:start a před fn:called
    const executeIdx = callOrder.findIndex((s) => s.startsWith('execute:'));
    expect(txStart).toBeLessThan(executeIdx);
    expect(executeIdx).toBeLessThan(fnCalled);
    expect(fnCalled).toBeLessThan(txEnd);
  });

  it('chyba v fn() propaguje error (transakce je rollbacknuta)', async () => {
    // db.transaction() v reálné implementaci by rollbacklo;
    // zde testujeme že withTenantContext re-throws error z fn()
    const db: DbAdapter = {
      query: vi.fn(async () => []),
      execute: vi.fn(async () => undefined),
      transaction: vi.fn(async (fn: (tx: DbAdapter) => Promise<unknown>) => {
        // Simuluje rollback — pokud fn() hodí, transaction hodí taky
        return fn(db);
      }),
    };

    const error = new Error('DB query failed');
    await expect(
      withTenantContext(db, { role: 'service' }, async () => {
        throw error;
      }),
    ).rejects.toThrow('DB query failed');
  });

  // ── UUID validace ─────────────────────────────────────────────────────

  it('UUID validace: platné UUID promoterId projde bez chyby', async () => {
    const { db } = createMockDb();
    const context: TenantContext = { role: 'promoter', promoterId: PROMOTER_UUID, userId: USER_UUID };

    await expect(
      withTenantContext(db, context, async () => 'ok'),
    ).resolves.toBe('ok');
  });

  it('UUID validace: neplatný promoterId hází error (SQL injection prevence)', async () => {
    const { db } = createMockDb();
    const context: TenantContext = {
      role: 'promoter',
      promoterId: "'; DROP TABLE catalog.events; --",
      userId: USER_UUID,
    };

    await expect(
      withTenantContext(db, context, async () => undefined),
    ).rejects.toThrow('RLS security error');
  });

  it('UUID validace: neplatný userId hází error', async () => {
    const { db } = createMockDb();
    const context: TenantContext = {
      role: 'buyer',
      userId: 'not-a-uuid',
    };

    await expect(
      withTenantContext(db, context, async () => undefined),
    ).rejects.toThrow('RLS security error');
  });

  it('UUID validace: prázdný promoterId (undefined) projde bez UUID validace', async () => {
    const { db, executeCalls } = createMockDb();
    const context: TenantContext = { role: 'service' };

    await expect(
      withTenantContext(db, context, async () => 'ok'),
    ).resolves.toBe('ok');

    const promoterSql = executeCalls.find((c) => c.sql.includes('current_promoter_id'));
    expect(promoterSql?.sql).toBe(`SET LOCAL app.current_promoter_id = ''`);
  });

  it('UUID validace: prázdný userId (undefined) projde bez UUID validace', async () => {
    const { db, executeCalls } = createMockDb();
    const context: TenantContext = { role: 'admin' };

    await expect(
      withTenantContext(db, context, async () => 'ok'),
    ).resolves.toBe('ok');

    const userSql = executeCalls.find((c) => c.sql.includes('current_user_id'));
    expect(userSql?.sql).toBe(`SET LOCAL app.current_user_id = ''`);
  });

  // ── Role whitelist validace ───────────────────────────────────────────

  it('throws on invalid role value (SQL injection prevence)', async () => {
    const { db } = createMockDb();
    // TypeScript by toto normálně zamítl, ale za runtime může útočník
    // poslat libovolný string přes HTTP — proto je nutná runtime validace.
    const context = { role: "'; DROP TABLE users; --" } as unknown as TenantContext;

    await expect(
      withTenantContext(db, context, async () => undefined),
    ).rejects.toThrow('RLS security error');
  });

  it('throws on neznámá role (ani service/admin/promoter/buyer)', async () => {
    const { db } = createMockDb();
    const context = { role: 'superuser' } as unknown as TenantContext;

    await expect(
      withTenantContext(db, context, async () => undefined),
    ).rejects.toThrow('RLS security error');
  });

  it('platné role projdou whitelist validací bez chyby', async () => {
    const validRoles = ['service', 'admin', 'promoter', 'buyer'] as const;

    for (const role of validRoles) {
      const { db } = createMockDb();
      const context: TenantContext =
        role === 'promoter'
          ? { role, promoterId: PROMOTER_UUID, userId: USER_UUID }
          : role === 'buyer'
            ? { role, userId: USER_UUID }
            : { role };

      await expect(
        withTenantContext(db, context, async () => 'ok'),
      ).resolves.toBe('ok');
    }
  });

  // ── Role-specific chování ─────────────────────────────────────────────

  it('role=admin: promoterId může být undefined', async () => {
    const { db, executeCalls } = createMockDb();
    const context: TenantContext = { role: 'admin', userId: USER_UUID };

    await withTenantContext(db, context, async () => undefined);

    const sqls = executeCalls.map((c) => c.sql);
    expect(sqls).toContain(`SET LOCAL app.current_role = 'admin'`);
    expect(sqls).toContain(`SET LOCAL app.current_promoter_id = ''`);
  });

  it('role=service: promoterId i userId mohou být undefined', async () => {
    const { db, executeCalls } = createMockDb();

    await withTenantContext(db, { role: 'service' }, async () => undefined);

    const sqls = executeCalls.map((c) => c.sql);
    expect(sqls).toContain(`SET LOCAL app.current_role = 'service'`);
    expect(sqls).toContain(`SET LOCAL app.current_promoter_id = ''`);
    expect(sqls).toContain(`SET LOCAL app.current_user_id = ''`);
  });
});
