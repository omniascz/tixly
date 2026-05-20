import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockClient = {
  query: vi.fn(),
  release: vi.fn(),
};
const mockRawPool = {
  connect: vi.fn(async () => mockClient),
  query: vi.fn(),
  end: vi.fn(),
};

vi.mock('pg', () => ({
  Pool: vi.fn(() => mockRawPool),
}));

import {
  runWithPromoterContext,
  runWithPlatformAdminContext,
  db,
  getCurrentRlsContext,
} from './rls-pool';

beforeEach(() => {
  mockClient.query.mockReset();
  mockClient.release.mockReset();
  mockRawPool.connect.mockClear();
  mockRawPool.query.mockReset();
});

describe('runWithPromoterContext', () => {
  it('odmítne invalid UUID', async () => {
    await expect(
      runWithPromoterContext('not-uuid', async () => 'X'),
    ).rejects.toThrow(/invalid promoterId/);
  });

  it('uvnitř callback je ALS context dostupný', async () => {
    const promoterId = '11111111-1111-1111-1111-111111111111';
    let captured: ReturnType<typeof getCurrentRlsContext>;
    await runWithPromoterContext(promoterId, async () => {
      captured = getCurrentRlsContext();
    });
    expect(captured?.promoterId).toBe(promoterId);
  });

  it('mimo callback je context undefined', () => {
    expect(getCurrentRlsContext()).toBeUndefined();
  });
});

describe('db().query() v promoter context', () => {
  it('BEGIN + SET LOCAL + query + COMMIT', async () => {
    mockClient.query.mockResolvedValue({ rows: [], rowCount: 0, command: '', oid: 0, fields: [] });
    const promoterId = '22222222-2222-2222-2222-222222222222';

    await runWithPromoterContext(promoterId, async () => {
      await db().query('SELECT * FROM catalog.events');
    });

    expect(mockClient.query).toHaveBeenNthCalledWith(1, 'BEGIN');
    expect(mockClient.query).toHaveBeenNthCalledWith(
      2,
      `SET LOCAL app.current_promoter_id = '${promoterId}'`,
    );
    expect(mockClient.query).toHaveBeenNthCalledWith(3, 'SELECT * FROM catalog.events', undefined);
    expect(mockClient.query).toHaveBeenNthCalledWith(4, 'COMMIT');
    expect(mockClient.release).toHaveBeenCalled();
  });

  it('ROLLBACK + release při chybě', async () => {
    mockClient.query.mockImplementation(async (sql: string) => {
      if (sql === 'BEGIN') return {};
      if (sql.startsWith('SET LOCAL')) return {};
      if (sql === 'BAD') throw new Error('query failed');
      return {};
    });
    await expect(
      runWithPromoterContext('33333333-3333-3333-3333-333333333333', async () => {
        await db().query('BAD');
      }),
    ).rejects.toThrow(/query failed/);
    expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
    expect(mockClient.release).toHaveBeenCalled();
  });
});

describe('db().query() v platform admin context', () => {
  it('SET LOCAL is_platform_admin = true', async () => {
    mockClient.query.mockResolvedValue({ rows: [] });
    await runWithPlatformAdminContext(async () => {
      await db().query('SELECT 1');
    });
    expect(mockClient.query).toHaveBeenCalledWith(
      "SET LOCAL app.is_platform_admin = 'true'",
    );
  });
});

describe('db().query() BEZ context', () => {
  it('direct query bez session vars (žádný BEGIN)', async () => {
    mockRawPool.query.mockResolvedValue({ rows: [{ x: 1 }] });
    const r = await db().query('SELECT 1');
    expect(r.rows).toEqual([{ x: 1 }]);
    expect(mockRawPool.connect).not.toHaveBeenCalled();
    expect(mockRawPool.query).toHaveBeenCalledWith('SELECT 1', undefined);
  });
});

describe('nested contexts', () => {
  it('vnořený context má vlastní store, vnější je pak zpět', async () => {
    let outer: string | undefined;
    let inner: string | undefined;
    let afterInner: string | undefined;
    await runWithPromoterContext('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', async () => {
      outer = getCurrentRlsContext()?.promoterId;
      await runWithPromoterContext('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', async () => {
        inner = getCurrentRlsContext()?.promoterId;
      });
      afterInner = getCurrentRlsContext()?.promoterId;
    });
    expect(outer).toBe('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
    expect(inner).toBe('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
    expect(afterInner).toBe('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
  });
});
